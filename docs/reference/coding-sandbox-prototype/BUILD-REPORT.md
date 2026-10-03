# Jarvis hosted-agent build capacity measurement

Run date: 2026-10-02. Region/project: `rg-jarvis-poc`, Sweden Central,
Foundry account `jarvispoc1002foundry`, project `jarvis-poc-202610020830`.
Provider: Copilot ACP inside the hosted-agent runner.

## Method

- Built `jarvispocscacr.azurecr.io/jarvis-runner:runner-dotnet-202610022238`
  from deployed runner image `runner-20261002113335` plus .NET SDK 8.0.
  ACR compressed size: base image 749,526,809 bytes; .NET image
  970,930,122 bytes.
- Created only temporary agents:
  - `jarvis-runner-build-1x2`: 1 vCPU / 2 GiB, version 1.
  - `jarvis-runner-build-2x4`: 2 vCPU / 4 GiB, version 1.
- Granted the same runtime roles as `jarvis-runner`: Key Vault Secrets User,
  Key Vault Secrets Officer on `codex-login`, and Monitoring Metrics Publisher.
- Deleted every measurement session and both temporary agents at the end.
  `jarvis-runner` was not changed.

## Repository used

Primary .NET target: `dotnet/orleans` tag `v8.2.0`, MIT license, `Orleans.sln`.
It is a realistic multi-project .NET solution with many source and test
projects. The shallow checkout was about 69 MiB before restore; NuGet restore
expanded the package cache to about 2.4 GiB.

For the requested test repo isolation, I also opened an unmerged PR with the
sample source copied under `dotnet-sample/`:
<https://github.com/DanAakesen/jarvis-poc-target/pull/13>.

JS/TS monorepo measurement was not run; the .NET run hit disk first.

## Results

### 1 vCPU / 2 GiB

Session: `0637c1f0e0eb99b700SpxX8fyVUliiEvLCbZBBzvQCtXdKcu1l`.

| Step | Result | Wall time | Max RSS | CPU | Disk after step |
| --- | --- | ---: | ---: | ---: | --- |
| Full single-branch clone | Pass | 4.18 s | 33,500 KiB | 77% | removed after comparison |
| Shallow partial clone | Pass | 2.37 s | 20,520 KiB | 15% | checkout about 69 MiB |
| `dotnet restore Orleans.sln` | Pass | 3:14.27 | 515,536 KiB | 15% | 219 MiB free |
| `dotnet build Orleans.sln` | Interrupted | n/a | n/a | n/a | no after-build snapshot; live check 213 MiB free |

Initial disk was 6.0 GiB total with about 3.0 GiB free. After restore,
`/`, `/home/runner`, `/files`, `/tmp`, and the working directory all reported
the same `/dev/vdb` filesystem at 97% used. The build log stopped after the
first few project outputs, with no compiler error or OOM text. The binding
limit was disk headroom, not memory.

### 2 vCPU / 4 GiB

Sessions: `0c30aa6e43f5ca0400d67Jof0ubQ2SrsMinvx5BmyKxh7k7Ycz`
(compact rerun) and `0275aa0b549fdc9300OLeYYqbsXcdHKFpFTELdGRiDcWJUFfbk`
(first interrupted run).

| Step | Result | Wall time | Max RSS | CPU | Disk after step |
| --- | --- | ---: | ---: | ---: | --- |
| Shallow partial clone | Pass | 2.37 s | 20,492 KiB | 16% | normal |
| `dotnet restore Orleans.sln` | Pass | 54.96 s | 498,544 KiB | 59% | 219 MiB free |
| `dotnet build Orleans.sln` | Interrupted | n/a | n/a | n/a | 67 MiB free / 99% used |

The 2x4 sandbox exposed 2 CPUs and 4 GiB RAM, but the writable filesystem was
still the same 6.0 GiB `/dev/vdb`. The build did not reach a completed
`/usr/bin/time` record; after the interrupted build attempt, only 67 MiB were
available. CPU cgroup stats showed no throttling in the captured output.

## Memory and OOM evidence

The expected cgroup memory files (`memory.max`, `memory.current`,
`memory.peak`, `memory.events`) were not exposed in these hosted sandboxes;
only CPU cgroup files were visible. No `exit 137`, OOM-kill text, or dmesg
evidence was captured. Per-process `/usr/bin/time -v` peaks stayed around
500 MiB for restore. The first observed hard constraint was disk.

## Disk-gap explanation

The earlier 742-file TypeScript run reported 2.1 GiB used and 3.5 GiB free
because it was also on one shared root filesystem, not separate mounts. In
this .NET image every checked path showed the same device:

- `/`, `/home/runner`, `/files`, `/tmp`, and the working directory:
  `/dev/vdb`, 6.0 GiB total.
- Initial free space with the .NET SDK image: about 3.0 GiB.
- Baseline consumers included `/usr/local` about 1.4 GiB and
  `/usr/share/dotnet` about 572 MiB, plus OS, runner, Copilot, npm and image
  layers.
- NuGet restore then added about 2.4 GiB under `.nuget/packages`, leaving too
  little space for `obj/bin`.

So the gap is not a hidden `/files` or `$HOME` mount. The documented "up to
20 GiB" was not observed here; this project/image got a 6 GiB writable root,
with image and system contents already consuming roughly half.

## Cheap savings measured

| Saving | Evidence |
| --- | --- |
| Shallow/partial clone | Improved clone from 4.18 s / 33,500 KiB RSS to 2.37 s / 20,520 KiB RSS. Helpful, but tiny compared with NuGet restore. |
| `dotnet build -m:1` | Not reached; restore left only 219 MiB free, so solution build could not complete far enough to compare. |
| `UseSharedCompilation=false` | Not reached for the same disk reason. |
| Build one project vs solution | Not reached; disk was exhausted before the scripted single-project step. |
| `NODE_OPTIONS=--max-old-space-size` | Not measured; JS/TS monorepo was skipped after .NET hit disk. |

## Recommendation

- Use 2 vCPU / 4 GiB for .NET tasks when using Foundry hosted agents; it
  restored Orleans about 3.5x faster than 1x2.
- Do not expect larger .NET solution builds to fit unless writable disk is
  increased or dependencies are prewarmed/pruned. Shallow clone alone is not
  enough; NuGet cache dominates.
- For Jarvis: keep Foundry for small targeted edits, single projects, and
  smaller test projects. For realistic large .NET solution builds, use a
  fallback with controllable disk, such as Container Apps Jobs, or run full
  solution builds only in GitHub Actions as already planned.
- If Foundry remains the coding sandbox, set `NUGET_PACKAGES` inside the
  workspace, prefer shallow clones, build one project/test project at a time,
  and delete `bin/obj` between attempts. Treat full-solution restore/build as
  a CI responsibility, not a hosted-agent coding step.

## Cleanup

Deleted sessions:

- `0637c1f0e0eb99b700SpxX8fyVUliiEvLCbZBBzvQCtXdKcu1l`
- `0275aa0b549fdc9300OLeYYqbsXcdHKFpFTELdGRiDcWJUFfbk`
- `0d26dca89cae5a6c00HVv45uWIHm24m0Syqq1o4KsVXvPyU1yM`
- `0c30aa6e43f5ca0400d67Jof0ubQ2SrsMinvx5BmyKxh7k7Ycz`

Deleted agents:

- `jarvis-runner-build-1x2`
- `jarvis-runner-build-2x4`
