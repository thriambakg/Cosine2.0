"""Quick test to find ix:nonFraction tags"""
import re

with open('0001628280-25-045968_9e6a49ae.txt', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()[:3000000]  # First 3MB

# Find all ix:nonFraction tags with revenue
pattern = r'<ix:nonFraction[^>]*name="([^"]*Revenue[^"]*)"[^>]*>([^<]+)</ix:nonFraction>'
matches = re.findall(pattern, content, re.IGNORECASE)

print(f"Found {len(matches)} revenue ix:nonFraction tags")
for name, value in matches[:10]:
    print(f"  {name}: {value}")

# Find any ix:nonFraction tags
pattern2 = r'<ix:nonFraction[^>]*name="([^"]+)"[^>]*contextRef="([^"]+)"[^>]*>([^<]+)</ix:nonFraction>'
matches2 = re.findall(pattern2, content, re.IGNORECASE)

print(f"\nFound {len(matches2)} total ix:nonFraction tags (first 10):")
for name, ctx, value in matches2[:10]:
    clean_value = value.replace(',', '').strip()
    try:
        num = float(clean_value)
        if abs(num) > 1000000:  # Only show large values
            print(f"  {name}: {value} (ctx: {ctx})")
    except:
        pass

