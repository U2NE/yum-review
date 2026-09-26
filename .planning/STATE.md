# Project State

<!-- hybrid-state:v1
{
  "schema": "hybrid-state/v1",
  "schemaVersion": 1,
  "phase": "03-nextjs-supabase",
  "status": "active",
  "nextAction": "Restore hosted Supabase schema/API access using the actual IPv4 Session pooler connection or authenticated SQL dashboard, then apply pending migrations and verify anonymous catalog/menu detail. Preserve all Gompocha menus and photo links with before/after fingerprints. Task 09 remains PARTIAL.",
  "blockers": [
    "Task 09 remains PARTIAL: the 57-case role/viewport matrix is incomplete. A member pointer pass at 1265×720 covers selected home filters, menu detail, my-review search, favorite/like toggles, review edit cancel, and half-star selection/deselection. Cookie-free HTTP checks confirm selected public routes return 200 and selected protected routes redirect to /login, but do not exercise browser UI or prove rendered guest behavior. The available CUA browser inventory exposed only the authenticated in-app browser; a second tab inherited the member session, so a separate guest browser context is unavailable. Guest/owner/server-admin full UI flows, remaining viewport/path combinations, back/forward for the newest pointer pass, and saved screenshots remain unverified.",
    "The user authorized database additions/deletions for pre-service repair on 2026-09-27; preserve all Gompocha menus/photo associations. Both QA reviews remain unchanged during the hosted diagnostic pass.",
    "Positive local Vault/HMAC key parity and live image-verification with an active verified upload remain untested. The PENDING intent failure/release path when its Storage object is absent is also untested.",
    "The server verifies stored-object bytes but cannot independently prove the original file size asserted before direct optimized upload; a modified client could falsify original_bytes.",
    "Local migration/runtime and browser evidence do not establish source/target data import completeness or checksums. Data import/checksum reconciliation remains open.",
    "Hosted anonymous GET /rest/v1/menus and /rest/v1/restaurants each return HTTP 404 PGRST205: the tables are absent from the exposed Data API schema cache. Direct SQL access is required to distinguish unapplied migrations from schema exposure/cache configuration. The direct DB endpoint is IPv6-only and exact AAAA connection fails ENETUNREACH; bounded aws-0 Seoul/Tokyo/Singapore Session pooler preflights each return XX000 tenant/user not found. No hosted database or Storage writes occurred. Actual project IPv4 Session pooler host or authenticated Supabase SQL dashboard access is required. Vercel deployment success does not establish backend readiness. Task 09 remains PARTIAL."
  ],
  "activeSpec": ".planning/phases/03-nextjs-supabase/SPEC.md",
  "activePlan": ".planning/phases/03-nextjs-supabase/PLAN.md",
  "clarification": {
    "active": false,
    "status": "approved-for-planning",
    "type": "brownfield",
    "initialIdea": "Implement five confirmed product components: admin roles and catalog management; review scoring, consent and image uploads; cuisine and radius discovery; Dankook Jukjeon restaurant/menu seed; researched editorial redesign.",
    "threshold": 0.2,
    "thresholdSource": "default",
    "rounds": [
      {
        "round": 1,
        "targetComponent": "seed",
        "targetDimension": "constraints",
        "why": "seed × constraints is the weakest active clarity pair: image reuse rights and reliable source rules are not yet defined.",
        "challengeMode": null,
        "question": "For the initial Dankook Jukjeon catalog, may we manually verify restaurant names, addresses, menus and prices in Naver Map and link each listing, while using only photos with confirmed permission or uploaded by an authorized owner/admin?",
        "answer": "메뉴사진도 있으면 붙여 없으면 건너 뛰고",
        "scoresBefore": {
          "admin": {
            "goal": 0.85,
            "constraints": 0.85,
            "criteria": 0.75,
            "context": 0.7
          },
          "reviews": {
            "goal": 0.65,
            "constraints": 0.45,
            "criteria": 0.65,
            "context": 0.65
          },
          "discovery": {
            "goal": 0.7,
            "constraints": 0.4,
            "criteria": 0.7,
            "context": 0.8
          },
          "seed": {
            "goal": 0.7,
            "constraints": 0.3,
            "criteria": 0.55,
            "context": 0.7
          },
          "design": {
            "goal": 0.9,
            "constraints": 0.35,
            "criteria": 0.4,
            "context": 0.85
          }
        },
        "scoresAfter": {
          "admin": {
            "goal": 0.85,
            "constraints": 0.85,
            "criteria": 0.75,
            "context": 0.7
          },
          "reviews": {
            "goal": 0.65,
            "constraints": 0.45,
            "criteria": 0.65,
            "context": 0.65
          },
          "discovery": {
            "goal": 0.7,
            "constraints": 0.4,
            "criteria": 0.7,
            "context": 0.8
          },
          "seed": {
            "goal": 0.8,
            "constraints": 0.5,
            "criteria": 0.7,
            "context": 0.75
          },
          "design": {
            "goal": 0.9,
            "constraints": 0.75,
            "criteria": 0.65,
            "context": 0.85
          }
        },
        "ambiguityBefore": 0.4375,
        "ambiguityAfter": 0.4
      },
      {
        "round": 2,
        "targetComponent": "discovery",
        "targetDimension": "constraints",
        "why": "After recording the user’s menu-photo preference and applying the researched visual constraints, discovery × constraints is now the lowest active clarity pair (0.40).",
        "challengeMode": null,
        "question": "거리 필터는 어떤 위치를 중심으로 할까요? 제안은 캠퍼스를 기본값으로 두고 사용자가 주소/장소를 검색해 중심을 바꾸게 하는 방식입니다. (장소 검색에는 NAVER Maps API 키가 필요할 수 있습니다.)",
        "answer": "단국대를 현재 위치로 하고, 장소 검색도 되게하자, 옆에 현재 위치로하기도 넣을 수 있으면 넣고",
        "scoresBefore": {
          "admin": {
            "goal": 0.85,
            "constraints": 0.85,
            "criteria": 0.75,
            "context": 0.7
          },
          "reviews": {
            "goal": 0.65,
            "constraints": 0.45,
            "criteria": 0.65,
            "context": 0.65
          },
          "discovery": {
            "goal": 0.7,
            "constraints": 0.4,
            "criteria": 0.7,
            "context": 0.8
          },
          "seed": {
            "goal": 0.8,
            "constraints": 0.5,
            "criteria": 0.7,
            "context": 0.75
          },
          "design": {
            "goal": 0.9,
            "constraints": 0.75,
            "criteria": 0.65,
            "context": 0.85
          }
        },
        "scoresAfter": {
          "admin": {
            "goal": 0.85,
            "constraints": 0.85,
            "criteria": 0.75,
            "context": 0.7
          },
          "reviews": {
            "goal": 0.65,
            "constraints": 0.45,
            "criteria": 0.65,
            "context": 0.65
          },
          "discovery": {
            "goal": 0.8,
            "constraints": 0.85,
            "criteria": 0.75,
            "context": 0.85
          },
          "seed": {
            "goal": 0.8,
            "constraints": 0.5,
            "criteria": 0.7,
            "context": 0.75
          },
          "design": {
            "goal": 0.9,
            "constraints": 0.75,
            "criteria": 0.65,
            "context": 0.85
          }
        },
        "ambiguityBefore": 0.4,
        "ambiguityAfter": 0.4
      },
      {
        "round": 3,
        "targetComponent": "reviews",
        "targetDimension": "constraints",
        "why": "The weakest unresolved pair is reviews × constraints (0.45): the request says the site average should be 2.5, but that could mean a reference point, an exact global recalibration, or a default score for unrated menus.",
        "challengeMode": null,
        "question": "현재 리뷰 입력은 1–5점이고 메뉴 평점은 입력값의 산술 평균입니다. “사이트 평균 2.5”는 어떤 뜻인가요? 전체 평균을 정확히 2.5로 보정하면 새 리뷰에 따라 다른 메뉴 표시점수도 바뀝니다.",
        "answer": "리뷰를 달 때 작은 문구로 2.5를 평균이라고 생각하고 별점을 매기도록 안내한다. 평점은 각 사용자가 실제 입력한 점수의 산술 평균으로 표시한다.",
        "scoresBefore": {
          "admin": {
            "goal": 0.85,
            "constraints": 0.85,
            "criteria": 0.75,
            "context": 0.7
          },
          "reviews": {
            "goal": 0.65,
            "constraints": 0.45,
            "criteria": 0.65,
            "context": 0.65
          },
          "discovery": {
            "goal": 0.8,
            "constraints": 0.85,
            "criteria": 0.75,
            "context": 0.85
          },
          "seed": {
            "goal": 0.8,
            "constraints": 0.5,
            "criteria": 0.7,
            "context": 0.75
          },
          "design": {
            "goal": 0.9,
            "constraints": 0.75,
            "criteria": 0.65,
            "context": 0.85
          }
        },
        "scoresAfter": {
          "admin": {
            "goal": 0.9,
            "constraints": 0.9,
            "criteria": 0.85,
            "context": 0.8
          },
          "reviews": {
            "goal": 0.85,
            "constraints": 0.85,
            "criteria": 0.85,
            "context": 0.75
          },
          "discovery": {
            "goal": 0.85,
            "constraints": 0.85,
            "criteria": 0.8,
            "context": 0.85
          },
          "seed": {
            "goal": 0.8,
            "constraints": 0.5,
            "criteria": 0.7,
            "context": 0.75
          },
          "design": {
            "goal": 0.9,
            "constraints": 0.8,
            "criteria": 0.75,
            "context": 0.85
          }
        },
        "ambiguityBefore": 0.4,
        "ambiguityAfter": 0.3075
      }
    ],
    "roundCount": 3,
    "currentAmbiguity": 0.1575,
    "currentScores": {
      "admin": {
        "goal": 0.9,
        "constraints": 0.9,
        "criteria": 0.9,
        "context": 0.85
      },
      "reviews": {
        "goal": 0.9,
        "constraints": 0.95,
        "criteria": 0.9,
        "context": 0.85
      },
      "discovery": {
        "goal": 0.85,
        "constraints": 0.9,
        "criteria": 0.85,
        "context": 0.9
      },
      "seed": {
        "goal": 0.9,
        "constraints": 0.75,
        "criteria": 0.85,
        "context": 0.85
      },
      "design": {
        "goal": 0.9,
        "constraints": 0.9,
        "criteria": 0.85,
        "context": 0.9
      }
    },
    "codebaseContext": "Scout evidence gathered: existing Spring Boot 4.1.1/PostgreSQL/React app; V1/V2 migrations already applied; no roles, coordinates, cuisine, image upload, catalog write API, or advanced sorts; current aggregate SQL uses raw AVG; local existing app data must be preserved.",
    "topology": {
      "status": "confirmed",
      "confirmedAt": "2026-09-25T05:26:53+09:00",
      "confirmation": {
        "round": 0,
        "question": "Proposed five components: admin roles/catalog; rating, consent and photos; cuisine/radius discovery; real Dankook Jukjeon catalog; researched redesign. Confirm this scope or add/remove/merge/split/defer components?",
        "answer": "5개 모두 진행 (추천)",
        "scoresBefore": null,
        "scoresAfter": null,
        "ambiguityBefore": null,
        "ambiguityAfter": 0.4375
      },
      "components": [
        {
          "id": "admin",
          "name": "관리자 권한과 메뉴 관리",
          "status": "active",
          "goal": "서버 관리자와 업주 관리자가 허용된 메뉴 CRUD 및 리뷰 삭제를 수행한다.",
          "clarity_scores": {
            "goal": 0.9,
            "constraints": 0.9,
            "criteria": 0.9,
            "context": 0.85
          },
          "weakest_dimension": "context"
        },
        {
          "id": "reviews",
          "name": "메뉴 평점·리뷰·사진",
          "status": "active",
          "goal": "2.5 기준의 리뷰 평점과 세부 정렬, 동의 체크, 메뉴·리뷰 사진을 제공한다.",
          "clarity_scores": {
            "goal": 0.9,
            "constraints": 0.95,
            "criteria": 0.9,
            "context": 0.85
          },
          "weakest_dimension": "context"
        },
        {
          "id": "discovery",
          "name": "음식 종류·지역 탐색",
          "status": "active",
          "goal": "음식 분류와 거리 반경으로 메뉴·가게를 필터링한다.",
          "clarity_scores": {
            "goal": 0.85,
            "constraints": 0.9,
            "criteria": 0.85,
            "context": 0.9
          },
          "weakest_dimension": "goal"
        },
        {
          "id": "seed",
          "name": "단국대 죽전 실매장 자료",
          "status": "active",
          "goal": "단국대 죽전캠퍼스 주변 식당·술집과 실제 메뉴·사진을 카탈로그에 채운다.",
          "clarity_scores": {
            "goal": 0.9,
            "constraints": 0.75,
            "criteria": 0.85,
            "context": 0.85
          },
          "weakest_dimension": "constraints"
        },
        {
          "id": "design",
          "name": "화면 디자인 개편",
          "status": "active",
          "goal": "음식 리뷰 서비스에 맞는 개성 있고 사용하기 쉬운 화면으로 개선한다.",
          "clarity_scores": {
            "goal": 0.9,
            "constraints": 0.9,
            "criteria": 0.85,
            "context": 0.9
          },
          "weakest_dimension": "criteria"
        }
      ],
      "deferrals": [],
      "lastTargetedComponentId": "reviews"
    },
    "challengeModesUsed": [],
    "ontologySnapshots": [],
    "softWarningShown": false,
    "exit": null,
    "pendingQuestion": null,
    "nextExpectedAction": "user-decision-on-preserved-review-before-public-migration",
    "specRevisions": [
      {
        "revision": 1,
        "changes": [
          "ratings use 0.5-point increments",
          "images over 10MB are optimized toward 10MB; files at least 100MB are rejected",
          "remove existing synthetic menu seed records and QA-only reviews",
          "make the visual system explicitly bespoke/editorial",
          "exclude unauthorized Naver photo downloading and persistent storage of NAVER Local API outputs"
        ],
        "naverPhotoException": "User requested direct download; implementation remains excluded unless the photo rights holder grants permission.",
        "ambiguity": 0.1575,
        "threshold": 0.2,
        "evaluatorPassed": true,
        "previousExit": "clarification-early-exit was superseded by the revised clarification evaluation",
        "recordedAt": "2026-09-24T21:02:57.224Z"
      }
    ],
    "planReviewHistory": [
      {
        "iteration": 2,
        "reviewedPlanSha256": "279c9fc0f1ec81b09dd68b0226c91e5f4a77202aee33d26dc49c76f3b0a0777c",
        "previousArchitectureDecision": "ITERATE: explicit image revocation, post-commit cleanup and retry required",
        "previousAuditorDecision": "ITERATE: fail-closed fixture cleanup; test dependencies; forced password change and safe bootstrap; media rights/lifecycle; upload resource controls; reproducible E2E; role API ownership; nonempty seed behavior",
        "revisionApplied": true,
        "status": "await-independent-review",
        "recordedAt": "2026-09-24T21:43:55.553Z"
      },
      {
        "iteration": 3,
        "reviewedPlanSha256": "c8625bbf4704c04013f9fb0d4a3b97a02dda352ed99cdce2e1c5d61a36c13ef1",
        "previousArchitectureDecision": "ITERATE: exact V2 fixture contents and extra/altered row fail-closed preflight required",
        "previousAuditorDecision": "ITERATE: URL/back-forward state, review-photo owner/association authorization, and decoupled seed dependencies required",
        "revisionApplied": true,
        "status": "revision-applied",
        "recordedAt": "2026-09-24T21:55:00.000Z"
      },
      {
        "iteration": 4,
        "reviewedPlanSha256": "690bda2e0fd8117b69a3be651951c4fb938e5137baca538ae52002a9614d1c59",
        "previousArchitectureDecision": "ITERATE: server-admin restaurant-owner assignment/revocation must be visible and testable in UI",
        "previousAuditorDecision": "ITERATE: actual localhost run/link handoff and button-by-button UI QA must be acceptance criteria",
        "revisionApplied": true,
        "status": "revision-applied",
        "recordedAt": "2026-09-24T22:00:00.000Z"
      },
      {
        "iteration": 5,
        "reviewedPlanSha256": "bc55722c89314b250f9244734566c2b596cd71b389c9fdfecb108214d5a74e91",
        "previousArchitectureDecision": "APPROVE with implementation guard: V3 replaces V1 integer score checks with the 0.5–5.0 half-step constraint",
        "previousAuditorDecision": "APPROVE: all prior findings and user handoff/button-QA criteria are covered",
        "revisionApplied": false,
        "status": "approved",
        "recordedAt": "2026-09-24T22:01:06.000Z"
      }
    ]
  },
  "revision": 66,
  "updatedAt": "2026-09-26T18:03:56.265Z"
}
-->

## Current

- Schema: hybrid-state/v1
- Phase: 03-nextjs-supabase
- Status: active
- Next action: Restore hosted Supabase schema/API access using the actual IPv4 Session pooler connection or authenticated SQL dashboard, then apply pending migrations and verify anonymous catalog/menu detail. Preserve all Gompocha menus and photo links with before/after fingerprints. Task 09 remains PARTIAL.
- Revision: 66
- Updated: 2026-09-26T18:03:56.265Z

This file is canonical project state. Do not silently reconstruct or reset it if the machine-readable block is corrupt or uses an unsupported schema.
