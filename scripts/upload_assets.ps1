Write-Host "Starting Cloudinary Upload (Images Only)..."

# Function to find the executable
function Get-CldPath {
    if (Get-Command cld -ErrorAction SilentlyContinue) {
        return "cld"
    }
    
    # Check common npm global path on Windows
    $npmPath = "$env:APPDATA\npm\cld.cmd"
    if (Test-Path $npmPath) {
        return $npmPath
    }
    
    return $null
}

$cldCmd = Get-CldPath

if (-not $cldCmd) {
    Write-Host "Warning: 'cld' command not found in PATH." -ForegroundColor Yellow
    Write-Host "Attempting to use npx (this might take a moment)..." -ForegroundColor Cyan
    $cldCmd = "npx -y cloudinary-cli"
}

Write-Host "Using command: $cldCmd"

# 1. Upload Images to 'assets/ssc-cgl' folder
# Matches logic: mathpix_raw_zips\ssc-cgl -> assets/ssc-cgl
$imagesPath = "C:\Users\Neuraedge\Documents\Divya\MeritEdge\Code\adda_ssc\mathpix_raw_zips\ssc-cgl"

if (Test-Path $imagesPath) {
    Write-Host "Uploading Images from $imagesPath to 'assets/ssc-cgl'..."
    
    # Construct the arguments string
    # mapping: local_folder -> cloud_folder
    $args = "uploader upload_dir `"$imagesPath`" -f assets/ssc-cgl"
    
    # Invoke-Expression is needed to handle the command string with spaces/args properly if strictly using string
    # But safer to just run it:
    if ($cldCmd -like "npx*") {
        Invoke-Expression "$cldCmd $args"
    }
    else {
        & $cldCmd uploader upload_dir "$imagesPath" -f assets/ssc-cgl
    }
    
}
else {
    Write-Host "Error: Images path not found: $imagesPath" -ForegroundColor Red
}

Write-Host "Upload process finished."
Write-Host "Please refresh the web page to verify images are loading."
