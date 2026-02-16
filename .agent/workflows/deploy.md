---
description: Deploy the application to Vercel via GitHub
---

# Deploy to Vercel

The application is configured to automatically deploy to Vercel whenever changes are pushed to the `main` branch on GitHub.

1.  **Stage your changes**:
    ```powershell
    git add .
    ```

2.  **Commit your changes**:
    ```powershell
    git commit -m "Your commit message"
    ```

3.  **Push to GitHub**:
    // turbo
    ```powershell
    git push origin main
    ```

4.  **Verification**:
    -   Check the Vercel dashboard to watch the build progress.
    -   Retrieve the commit ID to confirm what was deployed:
        ```powershell
        git rev-parse HEAD
        ```
