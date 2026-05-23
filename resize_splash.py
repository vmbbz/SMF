import os
from PIL import Image

logo_path = "assets/smf-logo-alt-fit.png"
if not os.path.exists(logo_path):
    print(f"Error: Logo file {logo_path} not found.")
    exit(1)

logo = Image.open(logo_path)

res_dir = "android/app/src/main/res"

# We walk through all files named splash.png in android/app/src/main/res
for root, dirs, files in os.walk(res_dir):
    for file in files:
        if file.lower() == "splash.png":
            target_path = os.path.join(root, file)
            try:
                # Open old splash to get target size
                old_img = Image.open(target_path)
                w, h = old_img.size
                old_img.close()
                
                # Create a black background
                new_img = Image.new("RGBA", (w, h), (0, 0, 0, 255))
                
                # Determine scaling. The logo should occupy a safe portion in the center
                # We want the logo to be at most 35% of the minimum dimension of the screen
                # This ensures perfect fit with no cropping of head/feet!
                max_logo_dim = int(min(w, h) * 0.35)
                
                # Maintain aspect ratio of logo
                lw, lh = logo.size
                ratio = min(max_logo_dim / lw, max_logo_dim / lh)
                new_lw = int(lw * ratio)
                new_lh = int(lh * ratio)
                
                # Resize logo with high quality lanczos
                resized_logo = logo.resize((new_lw, new_lh), Image.Resampling.LANCZOS)
                
                # Paste centered
                px = (w - new_lw) // 2
                py = (h - new_lh) // 2
                new_img.paste(resized_logo, (px, py), resized_logo if resized_logo.mode == "RGBA" else None)
                
                # Save replacing old splash.
                new_img.save(target_path, "PNG")
                print(f"Generated splash screen for {target_path} at size {w}x{h} with logo sized {new_lw}x{new_lh}")
            except Exception as e:
                print(f"Error generating splash for {target_path}: {e}")

print("All splash screens successfully centered and fit!")
