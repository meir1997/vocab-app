# Quiz viewport stability

The quiz uses fixed grid tracks at each breakpoint. Answers, typing controls and
correction share the response track. Review hides content without collapsing
tracks; absent context still reserves its slot. Context and correction examples
are limited to two lines. Full examples remain available in word details.

The compact layout applies to phones up to 600px wide, including 375x553 and
390x664. Body uses min-height: 100vh followed by 100dvh; card tracks do not depend
on viewport height, so Safari toolbar movement does not resize the card when
only viewport height changes. Focus calls use preventScroll and
correction never scrolls the document. Scoring, storage and native iOS are unchanged.

Run `node scripts/viewport-stability-browser.test.cjs` with Playwright installed.
The existing feedback-layout suite also invokes it, so the existing web CI job
runs this regression without workflow changes. Six viewport contexts run in
parallel. Each tests 20 production words (including the longest meanings and
examples), both choice and typing modes, correct/wrong/unknown answers, late
correction rendering and the next question. It uses the real correct-answer
timer and asserts exact equality of document scrollHeight, card height, card
top and scrollY on every rendered frame. It also requires viewport-sized page
height and checks that the example fits inside the correction panel.

Measured in Chromium mobile emulation (CSS px):

| Viewport | Document height | Card height | Card top | Scroll Y |
|---|---:|---:|---:|---:|
| 320x568 | 568 | 432 | 51 | 0 |
| 375x553 | 553 | 432 | 51 | 0 |
| 390x664 | 664 | 432 | 51 | 0 |
| 390x750 | 750 | 432 | 51 | 0 |
| 390x844 | 844 | 432 | 51 | 0 |
| 1440x900 | 900 | 524 | 93 | 0 |

Each row remains identical across all tested states and words (0px deltas).
Reported real-device baseline at 390x664: card 635px in prompt versus
425/455/477px in correction; document 799px versus 664px. At 375x553 the reported
scroll jump was 0 to 93px. Automated browser emulation does not verify the native
iPhone software keyboard or Safari's toolbar animation; those need device QA.
