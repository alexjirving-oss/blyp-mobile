# IVS Viewer Slot Attach Test

Run the automated slot attach test:

```
powershell -ExecutionPolicy Bypass -File scripts\run_ivs_slot_attach_test.ps1
```

What to do when prompted:
- On HOST phone: press Go Live.
- On VIEWER phone: join the stream.

Artifacts:
- Logs: `logs/ivs_slot_attach_<timestamp>.log`
- Summary: `logs/ivs_slot_attach_summary_<timestamp>.md`

Share the generated summary markdown back to Alex for analysis.
