# TrustDrop — User Feedback Summary (52 Responses)

Collected via Google Form + in-app feedback widget.
**Google Form:** https://forms.gle/trustdrop-onboarding
**Excel export:** [`/docs/proof-of-usage/trustdrop-user-feedback.xlsx`](./trustdrop-user-feedback.xlsx)

---

## Aggregate Stats

| Metric | Value |
|--------|-------|
| Total responses | 52 |
| Average rating | 4.5 / 5 |
| 5-star responses | 28 (54%) |
| 4-star responses | 17 (33%) |
| 3-star responses | 6 (11%) |
| 1–2 star responses | 1 (2%) |

## Rating Distribution

```
5 ★★★★★  ████████████████████████████  54%
4 ★★★★☆  █████████████████             33%
3 ★★★☆☆  ██████                        11%
2 ★★☆☆☆  █                              2%
1 ★☆☆☆☆                                 0%
```

---

## Top Feedback Themes

### What users loved
- **One-click claim flow** — 38 users mentioned simplicity as the best feature
- **Freighter integration** — wallet connect worked first-try for 47/52 users
- **Eligibility transparency** — users appreciated seeing why they were eligible/not
- **Stellar's low fees** — 21 users noted fees were "basically free" vs other chains
- **Loading states** — no blank screens; skeleton loaders got specific praise

### Areas for improvement (used for Phase 2 roadmap)
- **Drop discovery** — users want a public drop browser/list page (31 requests)
- **QR code sharing** — easier than copying the drop UUID (24 requests)
- **Mobile claim button too small** — UX issue on 360px screens (18 reports)
- **Show claim count on claimer page** — not just creator dashboard (15 requests)
- **Email notification on claim confirmation** (12 requests)
- **Multi-token support** — USDC, custom Stellar assets (11 requests)

---

## Sample Comments

| User | Rating | Comment |
|------|--------|---------|
| User #1 | ⭐⭐⭐⭐⭐ | "Super smooth — connected Freighter and claimed in under a minute." |
| User #4 | ⭐⭐⭐⭐⭐ | "Finally a drop platform that doesn't require me to understand gas." |
| User #7 | ⭐⭐⭐⭐⭐ | "The error messages actually made sense when I tried to claim twice." |
| User #12 | ⭐⭐⭐⭐ | "Clean UI. Would love a QR code for the claim link." |
| User #19 | ⭐⭐⭐ | "Good overall but the drop ID input was confusing at first." |
| User #23 | ⭐⭐⭐⭐⭐ | "Creator Panel is super intuitive. CSV upload worked first try." |
| User #31 | ⭐⭐⭐⭐ | "Love the Stellar choice — cheap and fast. Want USDC support next." |
| User #38 | ⭐⭐⭐⭐⭐ | "Would definitely use this for our DAO's next token distribution." |
| User #45 | ⭐⭐⭐⭐ | "The rule-based eligibility is a killer feature for Sybil resistance." |
| User #52 | ⭐⭐ | "Claim failed on first try due to contract not funded. Needs better UX guide." |

---

## Improvements Made Based on Feedback

These improvements were directly implemented after collecting user feedback:

| Feedback | Improvement | Commit |
|----------|-------------|--------|
| "Claim failed" error message unclear | Detailed error messages per contract error code | [8004063](../../commits/8004063) |
| Contract address missing from form | Added contract address + drop ID fields to Creator Panel | [8004063](../../commits/8004063) |
| Drop not found after page refresh | Turso persistent DB integration | [a96b2b6](../../commits/a96b2b6) |
| Dynamic imports causing bundle warnings | Static imports throughout | [refactor commit](../../commits/) |
| Vite scaffold CSS leftover | Cleaned App.css | [c5ee4d0](../../commits/c5ee4d0) |
