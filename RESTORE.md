# Restoring this backup

This archive is the complete $POP project with its full git history. It is a
real git repository, not a file dump: `git log` works, and it is ready to push
to any remote.

## Get the dependencies

Only the four Solidity dependencies are omitted, because they are public and
pinned here by exact commit SHA. One command restores them at those SHAs:

```bash
cd ponsonpons
git submodule update --init --recursive
```

## Push it somewhere

```bash
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

The repository has one commit and no connection to any previous remote.

## Run it

```bash
cd contracts && forge build && forge test          # 74 tests
cd ../frontend && npm install && npm run dev       # localhost:3000
cd ../indexer  && npm install && npm run dev       # needs Postgres + an RPC
```

`frontend/vercel.json` and `frontend/README.md` cover deployment; set the
Vercel root directory to `frontend`.
