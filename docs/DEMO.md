# Five-minute demo

The running app contains two real, disposable full stacks:

| Workspace         | UI                    | API  | Data |
| ----------------- | --------------------- | ---- | ---- |
| Checkout redesign | http://127.0.0.1:3000 | 8080 | 9000 |
| API sandbox       | http://127.0.0.1:3001 | 8081 | 9001 |

Ports are assigned automatically; these were the observed ports at launch. Each UI's `/marker` result was checked against its own workspace/API/data identity.

1. Show both workspace cards, branch names, service ports and runtime state.
2. Open **Checkout redesign** and inspect **Changes**: the frontend has one tracked heading change and one untracked notes file. History and Pull requests are separate views. GitHub is explicitly unavailable when `gh` is absent.
3. Use **Open app** on each card. The returned workspace identifiers differ, including their APIs and data service.
4. Stop one workspace. Open the other app to demonstrate isolation. Start the stopped workspace again.
5. Preview Destroy to show exact scope, retained branches, and the separate unchecked discard decision. Cancel the preview to keep the demo.

Closing the desktop retains the stacks. Use Stop on both cards when finished.

Reopen this prepared demo from the attached implementation worktree:

```sh
npm run demo:launch
```

The original package launches with separate personal state if opened directly; `demo:launch` selects `work/demo-state`. Demo repositories are under `work/demo`. None of these files or services belongs to the user's real projects.

This is an unsigned macOS arm64 demo. Real project onboarding, live GitHub/Compose, signing, stronger interrupted preparation recovery and the full release checklist remain future work.
