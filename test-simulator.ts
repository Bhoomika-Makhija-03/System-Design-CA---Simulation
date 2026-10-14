import {
  createInitialSimulationState,
  stepSimulation,
  toggleFeatureFlag,
  toggleComponentFailure,
  updateComponentCapacity,
  applyScenario,
} from './src/engine/simulationEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log('--- STARTING ACCEPTANCE TESTS FOR PS 28 SIMULATOR ---\n');

// Test 1 & 2: Turning flag ON and OFF updates phone preview
let state = createInitialSimulationState();
assert(state.flagState.desiredValue === false, 'Initial desired flag is OFF');
assert(state.flagState.phoneClientValue === false, 'Initial phone client flag is OFF');

state = toggleFeatureFlag(state);
assert(state.flagState.desiredValue === true, 'Toggling flag changes desiredValue to ON');
assert(state.flagState.phoneClientValue === true, 'When update path is healthy, phoneClientValue becomes ON');

state = toggleFeatureFlag(state);
assert(state.flagState.desiredValue === false, 'Toggling flag again changes desiredValue to OFF');
assert(state.flagState.phoneClientValue === false, 'Phone client receives OFF');

// Test 3: Broken update pathway prevents phone from receiving latest configuration until recovery
state = toggleComponentFailure(state, 'pubsub_broker');
assert(state.components.pubsub_broker.isFailed === true, 'Pub/Sub Broker is failed');

// Now toggle flag to ON while Pub/Sub is failed
state = toggleFeatureFlag(state);
assert(state.flagState.desiredValue === true, 'Desired flag is ON');
assert(
  state.flagState.phoneClientValue === false,
  'Phone preview remains on cached OFF because Pub/Sub is down (stale configuration)'
);
assert(
  state.flagState.propagationStatus === 'blocked_pubsub',
  'Propagation status correctly marked as blocked_pubsub'
);

// Recover Pub/Sub broker
state = toggleComponentFailure(state, 'pubsub_broker');
assert(state.components.pubsub_broker.isFailed === false, 'Pub/Sub Broker recovered');
assert(
  state.flagState.phoneClientValue === true,
  'After recovery, phone client resynchronizes to desired value (ON)'
);
assert(
  state.flagState.propagationStatus === 'synchronized',
  'Propagation status resynchronized'
);

// Test 4 & 5: Increasing traffic changes incoming load on relevant components according to their role
state.offeredLoad = 5000;
state = stepSimulation(state);
assert(
  state.components.client_instances.incomingLoad === 5000,
  'Client Instances receives offered load (5,000 req/s)'
);
assert(
  state.components.load_generator.incomingLoad === 5000,
  'Load Generator receives 5,000 req/s'
);
assert(
  state.components.client_sdk.incomingLoad === 5000,
  'Client SDK receives 5,000 req/s'
);
assert(
  state.components.local_flag_cache.incomingLoad === 5000,
  'Local Flag Cache receives 5,000 lookups/s'
);

// Test 8: Cloud Storage, Pub/Sub, and SSE do NOT receive every local evaluation request
assert(
  state.components.cloud_storage.incomingLoad <= 5,
  'Cloud Storage receives only idle/mutation load (<= 5 req/s), NOT evaluation requests'
);
assert(
  state.components.pubsub_broker.incomingLoad <= 5,
  'Pub/Sub Broker receives only idle/mutation load (<= 5 req/s), NOT evaluation requests'
);
assert(
  state.components.sse_server.incomingLoad <= 5,
  'SSE Server receives only idle/mutation load (<= 5 req/s), NOT evaluation requests'
);

// Test 6 & 7: Changing component capacity affects utilization, queueing, latency, or throughput
// Reduce Evaluation Engine capacity to 2,000 when load is 5,000
state = updateComponentCapacity(state, 'sdk_eval_engine', 2000);
assert(state.components.sdk_eval_engine.capacity === 2000, 'Evaluation Engine capacity tuned to 2,000 req/s');
state = stepSimulation(state);
assert(
  state.components.sdk_eval_engine.utilization === 100,
  'Evaluation Engine utilization hits 100%'
);
assert(
  state.components.sdk_eval_engine.queueDepth > 0,
  'Evaluation Engine queue builds up when incoming load exceeds capacity'
);
assert(
  state.metrics.successfulThroughput <= 2000,
  'High traffic produces a throughput bottleneck capped by component capacity'
);
assert(
  state.metrics.avgLatencyMs > 2.0,
  'Latency rises when queue delay increases'
);

// Test 9: Pub/Sub failure delays configuration updates but does not stop valid local evaluations
state = applyScenario(state, 'pubsub_failure');
assert(state.components.pubsub_broker.isFailed === true, 'Scenario 3: Pub/Sub Broker failed');
state = stepSimulation(state);
assert(
  state.metrics.successfulThroughput === 1500,
  'Local evaluations continue running at full 1,500 evals/s from local cache during Pub/Sub failure'
);
assert(
  state.metrics.errorRate === 0,
  'Zero errors for local evaluations during Pub/Sub failure'
);

// Test 10: Failure scenarios can be repeated
state = applyScenario(state, 'storage_failure');
assert(state.components.cloud_storage.isFailed === true, 'Scenario 4: Storage failure applied');
state = applyScenario(state, 'normal');
assert(state.components.cloud_storage.isFailed === false, 'Scenario 1: Reset to normal operation');
assert(state.components.pubsub_broker.isFailed === false, 'All components healthy in normal scenario');

// Test 11: Reset restores a known initial state
const resetState = createInitialSimulationState();
assert(resetState.offeredLoad === 1500, 'Reset restored offeredLoad to 1500');
assert(resetState.flagState.desiredValue === false, 'Reset restored desired flag to OFF');
assert(resetState.flagState.phoneClientValue === false, 'Reset restored phone client to OFF');
assert(
  resetState.flagState.lastPropagationTimeMs === 32.5,
  'Initial propagation latency is deterministically 32.5ms (sum of stages)'
);
assert(
  resetState.metrics.updatePropagationMs === 32.5,
  'Initial updatePropagationMs metric matches 32.5ms'
);
assert(
  Object.values(resetState.components).every((c) => !c.isFailed && c.health === 'healthy'),
  'All 10 components are healthy on reset'
);

// Test 12: Deterministic propagation latency calculation across sequential stages
let detState = createInitialSimulationState();
detState.networkDelayMs = 0;
detState.concurrentClients = 1000; // within 4000 capacity
detState = toggleFeatureFlag(detState);
// Expected: Config (8.0) + Storage (15.0) + PubSub (5.0) + SSE (4.0) + SDK (0.3) + Cache (0.2) + Net (0) = 32.5ms
assert(
  detState.flagState.lastPropagationTimeMs === 32.5,
  'Deterministic propagation latency at 0ms net delay is exactly 32.5ms'
);

// Repeated toggle with network delay = 40ms must be strictly deterministic (no random jitter)
detState.networkDelayMs = 40;
detState = toggleFeatureFlag(detState);
assert(
  detState.flagState.lastPropagationTimeMs === 72.5,
  'Deterministic propagation latency at 40ms net delay is exactly 72.5ms'
);

// Test 13: SSE Overload preserves offered fan-out load and models queueing/delay
let overloadState = createInitialSimulationState();
overloadState.concurrentClients = 5000; // exceeds SSE capacity of 4,000
overloadState.networkDelayMs = 0;
overloadState = toggleFeatureFlag(overloadState);

assert(
  overloadState.components.sse_server.incomingLoad === 5000,
  'SSE offered fan-out load is preserved at 5,000 (NOT clamped to capacity)'
);
assert(
  overloadState.components.sse_server.utilization === 100,
  'SSE server reaches 100% saturation when offered load exceeds capacity'
);
assert(
  overloadState.components.sse_server.queueDepth === 1000,
  'SSE queue buffers 1,000 excess client broadcasts (5,000 - 4,000)'
);
assert(
  overloadState.components.sse_server.health === 'warning',
  'SSE server health degrades to warning under queue overload'
);
assert(
  overloadState.components.sse_server.currentLatencyMs === 254,
  'SSE server latency degrades to 254.0ms (4.0ms base + 250ms queue delay)'
);
assert(
  overloadState.flagState.lastPropagationTimeMs === 282.5,
  'Total propagation latency reflects SSE fan-out queue delay (32.5ms + 250ms = 282.5ms)'
);

// Subsequent stepSimulation drains the SSE queue
overloadState = stepSimulation(overloadState);
assert(
  overloadState.components.sse_server.queueDepth === 0,
  'SSE queue drains on subsequent tick'
);
assert(
  overloadState.components.sse_server.health === 'healthy',
  'SSE server returns to healthy once queue drains'
);

console.log('\n🎉 ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY! 🎉');

