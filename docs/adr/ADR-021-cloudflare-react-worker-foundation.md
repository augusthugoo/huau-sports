# ADR-021 - React SPA + Cloudflare Worker foundation

**Status:** ACCEPTED  
**Date:** 2026-08-30

## Decision

HUAU V1 uses a React SPA built with Vite and the official Cloudflare Vite plugin, deployed with a Worker API in the same Cloudflare application. `/api/*` routes execute the Worker first; SPA navigation remains static-asset first.

D1 and R2 use explicit bindings and separate development/staging resources. Production resources are intentionally not created during Phase 0.

## Rationale

This follows the Cloudflare-first TRD, keeps static requests inexpensive, and allows Worker APIs and platform bindings to live beside the UI without Vercel as a required dependency.
