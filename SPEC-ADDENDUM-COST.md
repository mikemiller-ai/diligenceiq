# SPEC Addendum — Cost Control and Scale-to-Near-Zero Architecture

> Provided verbatim by Mike on 2026-10-01 during Phase 0 planning. Where this addendum conflicts with SPEC.md (e.g. §22's OpenSearch), this addendum wins.

# Cost Control and Scale-to-Near-Zero Architecture

Cost efficiency is a first-class product requirement.

DiligenceIQ is an interview/demo deployment and should incur minimal ongoing cost when it is not actively being used.

The architecture should:

- scale to near zero when idle;
- avoid always-on compute wherever practical;
- avoid continuously running search/database clusters solely for the demo;
- favor request-based/serverless AWS services;
- incur meaningful inference cost only when a user actually performs an analysis;
- preserve a credible path to higher-scale production infrastructure later.

## Cost-control principle

Optimize for:

Idle cost → as close to zero as practical

Active cost → proportional to actual usage

Do not provision infrastructure for hypothetical enterprise scale that the current workload does not require.

The current application should demonstrate production-quality engineering without paying for permanently running production-scale infrastructure.

## Preferred service characteristics

Favor services such as:

- AWS Lambda for backend compute
- API Gateway or equivalent request-based API layer
- S3 for SEC corpus and durable artifacts
- DynamoDB On-Demand for lightweight application state
- Amazon Bedrock for usage-based embeddings and generation
- CloudWatch with controlled log retention
- AWS Amplify / serverless Next.js hosting where appropriate
- other AWS services that have minimal or no idle compute cost

Avoid always-on EC2 instances, ECS services, provisioned databases, or continuously running clusters unless there is a compelling requirement.

## Search / vector retrieval cost requirement

Do NOT automatically choose OpenSearch simply because this is a RAG application.

Evaluate retrieval architecture against:

1. retrieval quality;
2. latency;
3. implementation complexity;
4. corpus size;
5. idle cost;
6. production evolution path.

For the supplied SEC corpus, strongly consider a pre-built retrieval index that can be stored durably in S3 and loaded by serverless compute when needed.

A valid architecture could be:

SEC Corpus
    ↓
Offline ingestion/indexing
    ↓
Precomputed embeddings + lexical/vector index
    ↓
S3
    ↓
Lambda loads/caches index
    ↓
Hybrid retrieval
    ↓
Context builder
    ↓
ONE Bedrock generation request

The index may remain cached in a warm Lambda execution environment for subsequent requests, but the architecture must not require permanently running compute.

If a managed vector/search service is selected instead, document why its retrieval benefits justify its idle cost.

## Separate offline and online costs

Treat indexing as an offline administrative process.

Indexing may temporarily consume compute and embedding API calls because it does not run continuously.

Runtime should be significantly cheaper:

User question
→ serverless compute
→ retrieval against existing index
→ one Bedrock generation request
→ persist result
→ compute returns to idle

Documents should NOT be re-embedded on every application deployment or user request.

## DynamoDB

Use DynamoDB On-Demand where persistence is needed for:

- projects;
- analyses;
- saved findings;
- IC Brief selections;
- demo sessions.

Do not provision fixed read/write capacity for this demo workload.

## Bedrock

Bedrock usage should be demand-driven.

The application must:

- generate document embeddings once during ingestion;
- never regenerate embeddings unnecessarily;
- invoke the generative model exactly once per analysis;
- avoid background LLM calls;
- avoid LLM calls merely to populate dashboards;
- avoid LLM calls for saving findings;
- avoid LLM calls for IC Brief assembly;
- track input/output token usage where available.

## Observability cost controls

CloudWatch logging must be useful but bounded.

Configure:

- explicit log retention;
- structured logs;
- no unnecessary debug logging in production;
- no logging of full SEC chunks or complete prompts unless explicitly enabled for debugging;
- no high-frequency background telemetry.

## No unnecessary scheduled workloads

Do not add scheduled polling, recurring indexing, periodic agents, or background jobs for the assessment deployment unless they provide necessary functionality.

The application should perform essentially no compute when nobody is using it.

## Cost visibility

Add lightweight request-level cost observability where practical.

Capture:

- embedding calls during ingestion;
- generative calls;
- input tokens;
- output tokens;
- retrieval requests;
- execution duration.

Do not claim exact dollar costs unless they are calculated from current configured model/service pricing.

## Architecture documentation

`docs/architecture.md` must include a section titled:

"Cost and Scaling Strategy"

Explain:

- which resources incur idle cost;
- which resources are usage-based;
- how the application approaches zero compute cost while idle;
- expected cost drivers;
- what architecture would change if usage grew substantially.

Also document the evolution path.

Example:

Current / Pilot:
S3-hosted search artifacts + Lambda retrieval

Growing Deployment:
Managed vector/search infrastructure

Enterprise Scale:
Dedicated search infrastructure, stronger tenancy controls,
advanced observability, private networking, and workload-specific scaling

The architecture should demonstrate that the pilot is not over-engineered while still providing a credible path to enterprise scale.

## Cost-related Definition of Done

The project is not complete until:

- there is no unnecessary always-on application compute;
- RAG generation occurs only in response to user analysis;
- document embeddings are reused;
- application state uses usage-based persistence where practical;
- log retention is explicitly configured;
- idle infrastructure cost is documented;
- major cost drivers are documented;
- the architecture can be explained clearly during the interview.
