# Architecture Overview

## Monolith Approach
The Enterprise Licensing Platform is built as a **Modular Monolith** using NestJS for the backend and Next.js for the frontend. 
We avoided premature microservices to maintain transactional integrity, reduce deployment complexity, and enforce strict module boundaries within a single codebase.

## System Architecture

```mermaid
graph TD
    UI[Next.js Admin UI] -->|HTTPS/REST, session cookie| API[NestJS API]
    Agent[Windows Agent e.g. PII Sentinel] -->|HTTPS, Bearer installation credential| AgentAPI[/api/v1/agent/*]
    AgentAPI --> API

    subgraph NestJS Backend
        Auth[Auth/RBAC Module]
        Org[Organization Module]
        Lic[Licensing Module]
        Inst[Installation Module]
        AgentMod[Agent Module]
        AgentTelem[Agent Telemetry Module]
        Enroll[Enrollment Tokens Module]
        Audit[Audit Module]

        Auth --> Org
        Auth --> Lic
        Auth --> Inst
        Auth --> Enroll
        Auth --> Audit
        Auth --> AgentTelem
        Enroll --> AgentMod
        AgentMod --> Inst
        AgentTelem --> Inst
    end

    API --> DB[(PostgreSQL)]
    API --> Cache[(Redis)]
```

## Core Modules
- **Auth / RBAC Module:** Handles identity verification and permission enforcement. Session-based for Users/VendorUsers; a separate credential scheme (`AgentAuthGuard`) authenticates Installations — see [Agent Protocol](./agent-protocol.md).
- **Organization Module:** Manages the enterprise, companies, and users hierarchy.
- **Licensing Module:** Manages products, entitlements, and license allocations.
- **Installation Module:** Tracks devices and software instances consuming licenses; exposes admin suspend/unsuspend/revoke.
- **Enrollment Tokens Module:** Lets Company/Enterprise Admins issue the single/limited-use tokens an agent redeems to activate.
- **Agent Module:** The `/api/v1/agent/*` surface an installed agent calls directly — register, heartbeat, policy, release.
- **Agent Telemetry Module:** Ingests operational pings, scan summaries, and enforcement aggregation windows from agents; queues administrative commands; provides fleet protection KPIs and telemetry status to customer administrators. See [Telemetry Model](./telemetry-model.md).
- **Audit Module:** Records all security and state-changing events.

## Persistence
- **PostgreSQL:** Primary relational database (via Prisma).
- **Redis:** Used for rate limiting, distributed caching, and future asynchronous job queues (BullMQ).
