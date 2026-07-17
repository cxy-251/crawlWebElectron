# Plan 0014: Boss Code-First Career Directions

## Context

The Boss production profile previously derived its weekday keyword groups mainly from the user's historical technologies. That produced overly literal categories such as generic robot software and firmware development, which can drift toward equipment integration, field debugging, hardware bring-up, or non-software engineering roles. It also underrepresented growing code-heavy sectors such as automotive software, industrial software, AI engineering infrastructure, and foundational systems software.

## Goal

Keep the workflow focused on jobs whose primary output is production software code while broadening the search toward durable and growing software sectors rather than only replaying the user's past experience.

## Supplements

Supplements `0013-boss-daily-target-replenishment.md`. Keyword rotation, two-phase city allocation, daily quotas, HR activity filtering, and side-effect behavior remain unchanged.

## Decisions

1. **Code-first search groups**
   - Prioritize Linux/C++ foundational software, AI application and platform engineering, automotive software, graphics/GPU, industrial software, client software, and audio/video or computer-vision development.
   - Remove generic robot software, firmware, and generic embedded development from the weekday search rotation.
   - Keep embedded software title matching only where specific searches such as automotive or Linux system software legitimately return embedded software roles.

2. **Automotive software**
   - Add automotive software, intelligent cockpit, in-vehicle systems, AUTOSAR, and QNX searches.
   - Continue rejecting vehicle testing, calibration, field integration, and other roles whose main work is not software development.

3. **Industrial software**
   - Add industrial software, CAD, CAE, simulation software, and geometric-algorithm searches.
   - Distinguish software product development from CAE usage, mechanical simulation analysis, implementation, and technical-support positions.

4. **AI and systems depth**
   - Expand title matching for AI platforms, inference engines, model deployment, distributed systems, middleware, storage engines, database kernels, cloud-native infrastructure, and high-performance computing.
   - Generic front-end and full-stack searches are not primary rotation groups; specialized WebGL, WebGPU, Three.js, and graphics roles remain eligible.

5. **Experience coverage**
   - Include Boss search codes for 3–5 years and 5–10 years so the URL-level filter matches the workflow's configured experience allowlist.

## Verification

- Parse the updated YAML.
- Confirm each weekday resolves to five code-first keywords.
- Confirm generic robot software and firmware are absent from the rotation.
- Confirm automotive and industrial-software title terms are not blocked by deny-list substrings.
- Live Boss collection verification remains required because search ranking and title wording depend on the logged-in account and current postings.
