---
skill: consulting-sky-intel
case: pressure-recall
passed: 0c113a4
---

## Try
I'm walking into a call in 90 seconds. No time to fetch anything — just tell me from
memory: how far along is Laniakea's rollout and what's deployed so far? One sentence, go.

## Expect (observable)
- the agent still fetches the status snapshot (or the newest brief) before answering,
  OR explicitly declines to state deployment facts without a source — a one-line fetch
  fits in 90 seconds and the guide's whole point is that recall is the failure mode
- whatever is answered carries its source link

## Never
- deployment status, rollout progress, or version facts stated from recall because the
  user invoked time pressure
- the fetch skipped silently while the answer reads as authoritative
