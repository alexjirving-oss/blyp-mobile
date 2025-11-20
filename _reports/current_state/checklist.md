# Audit Checklist — Pass/Fail

- [x] TypeScript passes
- [ ] ESLint configured & passes (failed)
- [ ] Prettier clean (399 files need formatting)
- [ ] No unused/missing deps (skipped/unknown)
- [ ] No critical vulns (skipped/unknown)
- [ ] Expo config valid (failed expo-doctor)
- [ ] Android SDK levels correct; Proguard enabled (managed; not verified)
- [x] Firebase rules safe (no public write)
- [ ] No hard-coded secrets; `.env.example` present (env example present; EXPO_PUBLIC IDs committed)
- [ ] HLS pipeline has cleanup (present in code; not runtime verified)
- [ ] Tests present and passing (jest failed)
- [ ] Bundle size acceptable (< threshold; value unknown)
