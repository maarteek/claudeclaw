---
name: timezone
description: Show current times across Mark's key locations. Use when Mark says "timezone", "what time is it", "team times", "check the time in", or wants to know working hours for his team.
---

# Timezone Dashboard

Show current times for Mark's key locations. Run this bash command and display the results in a clean table:

```bash
echo "---"
echo "Location         | Timezone              | Local Time"
echo "---"
for tz in "Morocco:Africa/Casablanca" "London:Europe/London" "Karachi:Asia/Karachi" "Brazil:America/Sao_Paulo" "Egypt:Africa/Cairo"; do
  IFS=':' read -r label zone <<< "$tz"
  time=$(TZ="$zone" date +"%I:%M %p (%a)")
  printf "%-16s | %-21s | %s\n" "$label" "$zone" "$time"
done
echo "---"
```

Format the output as a clean table. After the table, add a one-line note about who's likely in working hours (9am-6pm local) right now.

Key people by location:
- Morocco: Taha (business partner)
- London: Taha (sometimes works from here)
- Karachi: Dev team
- Brazil: Team
- Egypt: Mark's family
