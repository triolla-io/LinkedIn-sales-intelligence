"""Reports whether li_at and JSESSIONID are stored as plaintext (value) or encrypted (encrypted_value) in the linkedin-mcp Chromium profile."""
import os, sqlite3
from pathlib import Path

profile = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
print("Profile dir:", profile, "exists:", profile.exists())

for candidate in [profile / "Default" / "Cookies", profile / "Cookies"]:
    if candidate.exists():
        print("Found Cookies db at:", candidate)
        con = sqlite3.connect(f"file:{candidate}?mode=ro", uri=True)
        rows = con.execute(
            "SELECT name, length(value) AS v_len, length(encrypted_value) AS e_len "
            "FROM cookies WHERE host_key LIKE '%linkedin.com' "
            "AND name IN ('li_at','JSESSIONID')"
        ).fetchall()
        for r in rows:
            print(r)
        if not rows:
            print("No matching cookies — run `linkedin-mcp-server --login` first.")
        break
else:
    print("No Cookies db found under", profile)
