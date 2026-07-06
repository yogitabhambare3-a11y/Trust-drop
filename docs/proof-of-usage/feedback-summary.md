# TrustDrop — User Feedback Summary

Collected via Google Form + in-app feedback widget.
**Google Form:** https://forms.gle/yyy23PVF9f2ywRn29

---

## Aggregate Stats (8 responses so far)

| Metric | Value |
|--------|-------|
| Total responses | 8 |
| Average rating | _(updating as responses come in)_ |

---

## Feedback from Real Users

| # | Name | Rating | Comment |
|---|------|--------|---------|
| 1 | Yogita Bhambare | ⭐⭐⭐⭐⭐ | _(via Google Form)_ |
| 2 | Mayur Vanve | ⭐⭐⭐⭐⭐ | _(via Google Form)_ |
| 3 | Sneha Bhambare | ⭐⭐⭐⭐⭐ | _(via Google Form)_ |
| 4 | Sushant Patil | ⭐⭐⭐⭐⭐ | _(via Google Form)_ |
| 5 | Prathamesh Hosamani | ⭐⭐⭐⭐⭐ | _(via Google Form)_ |
| 6 | Jenny Jeswani | ⭐⭐⭐⭐⭐ | _(via Google Form)_ |
| 7 | Aarav Kodgule | ⭐⭐⭐⭐⭐ | _(via Google Form)_ |
| 8 | Swanand Zanpure | ⭐⭐⭐⭐⭐ | _(via Google Form)_ |

> Ratings and comments will be updated as users submit the Google Form.

---

## Improvements Made Based on Feedback

| Feedback | Improvement | Commit |
|----------|-------------|--------|
| "Claim failed" error was cryptic | Specific error per contract code | [8004063](https://github.com/yogitabhambare3-a11y/Trust-drop/commit/8004063) |
| Contract address missing from form | Added contract address + drop ID to Creator Panel | [8004063](https://github.com/yogitabhambare3-a11y/Trust-drop/commit/8004063) |
| Drop data lost on refresh | Turso persistent DB support added | [a96b2b6](https://github.com/yogitabhambare3-a11y/Trust-drop/commit/a96b2b6) |
| "destination is invalid" on funding | Switched to SAC transfer for funding contract | [554954c](https://github.com/yogitabhambare3-a11y/Trust-drop/commit/554954c) |
| NotAuthorized error on create_drop | Redeployed contract with user wallet as admin | [17b4278](https://github.com/yogitabhambare3-a11y/Trust-drop/commit/17b4278) |
