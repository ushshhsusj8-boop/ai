# Contributor and automation guidance

- Read README.md, CONTRIBUTING.md and SECURITY.md before changing the project.
- Keep account ownership checks, optimistic revisions and original-file checksums intact.
- Tests use synthetic accounts, documents and mocked model responses. Never call real models or read private account data in tests.
- Never commit credentials, account files, conversation exports or production configuration.
- Code execution is optional and requires the user's explicit Run action. Preserve its isolated Linux runner limits: 20 seconds, 384 MiB and no network.
- Do not start an executor, Docker service, background loop or unrelated service during tests.
- On Windows use pwsh.exe -NoLogo -NoProfile. Run npm run check and npm test for source changes.
- Documentation and this source repository do not grant access to any hosted deployment.
