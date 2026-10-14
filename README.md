# Feature Flag System Simulator

An interactive, browser-based simulator that brings a low-latency distributed feature flag service to life. Built as a system design microproject (PS 28), it lets you explore the full architecture — from client SDK evaluation to control plane propagation — by manipulating load, toggling flags, injecting failures, and watching everything respond in real time.

## What It Does

The simulator models a production-grade feature flag service with two distinct planes:

- **Evaluation path** — Clients → Load Generator → Client SDK → Local Flag Cache + SDK Evaluation Engine. Flag checks resolve entirely in-memory in ~1ms without touching cloud infrastructure.
- **Control plane (update path)** — Config Service → Cloud Storage → Pub/Sub Broker → SSE Update Server → Client SDK → Local Flag Cache. Flag mutations propagate via a streaming push pipeline.

A live mobile preview ("ShopEasy") reflects the phone client's current flag state, showing the switch between a standard checkout and a 1-Click Express Checkout experience as flag updates arrive.

## Architecture Components

| Node | Role |
|---|---|
| Client Instances | Mobile apps, browsers, and edge clients |
| Load Generator | Traffic ingress and concurrency simulation |
| Client SDK | Embedded library orchestrating cache and evaluation |
| Local Flag Cache | In-memory hash table for sub-millisecond lookups |
| SDK Evaluation Engine | Rule evaluation, percentage rollouts, user targeting |
| Configuration Service | Admin API for flag mutations and auditing |
| Cloud Configuration Storage | Durable persistence (DynamoDB / PostgreSQL) |
| Pub/Sub Broker | High-throughput event bus (Kafka / Redis) |
| SSE Update Server | Long-lived HTTP streaming connections to push deltas |
| Monitoring & Telemetry | Async aggregation of metrics and latency percentiles |

## Scenarios

Four pre-built scenarios illustrate key system design trade-offs:

1. **Normal Operation** — 1,500 req/s, all nodes healthy, ~1.1ms evaluation latency, flag updates reach clients in ~25ms via SSE.
2. **Traffic Spike** — Load surges to 7,500 req/s, exposing the SDK Evaluation Engine as the first bottleneck (capacity: 6,000 req/s). Queue depth and latency climb while the control plane stays idle.
3. **Pub/Sub Failure** — The event bus goes down. Flag mutations persist to storage but cannot broadcast to SSE or clients. Crucially, all 1,500 cached evaluations/sec continue serving fast — failure domains are isolated.
4. **Storage Failure** — Cloud Storage fails. New flag writes are rejected at the control plane, but every client evaluation continues uninterrupted from the local cache.

## Features

- **Live architecture canvas** — 10-node diagram with real-time health, utilization, and queue depth per component
- **Component inspector** — Click any node to view latency, capacity, and inject failures or adjust capacity on the fly
- **Feature flag toggle** — Triggers the full Config → Storage → Pub/Sub → SSE → SDK propagation pipeline with step-by-step event log entries
- **Traffic controls** — Dial offered load (req/s), concurrent clients, and simulated network delay
- **KPI metrics cards** — Throughput, avg/p95 latency, error rate, cache hit ratio, propagation time, total evaluations
- **Live SVG charts** — Scrolling offered load vs. throughput and latency history
- **Real-time event log** — Timestamped entries for every flag update, failure injection, recovery, and saturation warning
- **Mobile preview** — Reflects the phone client's actual received flag state in real time

## Tech Stack

- **React 19** with TypeScript
- **Tailwind CSS v4**
- **Vite 8**
- **Lucide React** for icons
- Pure in-browser simulation engine — no backend, no network calls

## Getting Started

```bash
npm install
npm run dev
