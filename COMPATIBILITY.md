# Compatibility and evidence

Development checkpoint: source20 plus owned native/browser/CLI qualification. Independent completion still requires rich datasets/private initialization and fresh source distribution. No paid provider call or external booking was used.

- Node 22.13+ (`node:sqlite`), Google GenAI 2.30.0, Express 5.3.0, Playwright 1.64.1, Undici 7.30.1, Zod 4.6.7; exact npm lockfile. No vendor/global cache ownership patch.
- Real Google SDK `models.generateContent`, explicit Developer API v1beta/custom fetch/abort and owned Undici pool; constructor Vertex/enterprise false. GoogleGenAI exposes no public close method; the application drains work and destroys its transport. Original complete JSON is the action authority; normalized SDK values are recorded separately.
- Real Playwright Chromium, fresh nonpersistent context, real forms and viewport PNGs. `handleSIGINT`, `handleSIGTERM` and `handleSIGHUP` false make the application the signal owner. Form and server checks enforce structured permission and actual reviewed identity.
- Original imported history retains unknown earlier authorization/model/delivery. Legacy source without instance UUID lacks cross-reset guarantees. Resource/deadline/body bounds are cooperative/postbuffer where documented; they do not prove OS isolation or service cancellation.
- Genuine pinned SDK plus controlled loopback HTTP is transport qualification only. Live enabled model/key/semantic/billing review, new Firedrill persisted scenarios, real accounts/connectors and publication/license remain external gates.

Public API references: [Google HttpOptions](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html), [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Playwright browser launch](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-handle-sigint). Pinned installed source/types are the compatibility authority for this checkpoint.
