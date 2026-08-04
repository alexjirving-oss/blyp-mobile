# Two-Phone Live Autocapture

Run the full automation (backend+Metro attach, logcats, gated verification):

```
powershell -ExecutionPolicy Bypass -File scripts\run_2phone_live_autocapture.ps1 -HostSerial "R5CX71NM1RK" -ViewerSerial "RFCY71ZFS6F" -KeepRunning
```

What PASS looks like:
- `Result: PASS (all gates met)`
- HOST/VIEWE​R/BACKEND markers printed, with matching StageArn/Session IDs.
- Remote video block shows `Added/first frame: yes` and `Track dropped: no`.

If a gate times out, the script prints `FAIL_REASON: <gate> timed out` with the last log lines to diagnose (SESSION MISMATCH and TRACK DROP are also flagged explicitly).
