'use client';

import { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';

/**
 * getCroppedImg
 * Utility to crop the image based on the area selected in Cropper
 */
async function getCroppedImg(imageSrc, pixelCrop) {
    const image = await createImage(imageSrc);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        return null;
    }

    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    // Fill with white background to avoid black bars on JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        pixelCrop.width,
        pixelCrop.height
    );

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Canvas is empty'));
                return;
            }
            resolve(blob);
        }, 'image/jpeg');
    });
}

function createImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener('load', () => resolve(image));
        image.addEventListener('error', (error) => reject(error));
        image.setAttribute('crossOrigin', 'anonymous');
        image.src = url;
    });
}


export default function ImageEditor({ isOpen, imageDataUrl, onSave, onCancel }) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [aspect, setAspect] = useState(null); // Default to Free (null)
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    const onCropComplete = useCallback((croppedArea, croppedAreaPixels) => {
        setCroppedAreaPixels(croppedAreaPixels);
    }, []);

    const handleSave = async () => {
        if (!croppedAreaPixels || !imageDataUrl) return;

        setIsSaving(true);
        try {
            const croppedImageBlob = await getCroppedImg(imageDataUrl, croppedAreaPixels);
            await onSave(croppedImageBlob);
        } catch (e) {
            console.error(e);
            alert("Error cropping image");
        } finally {
            setIsSaving(false);
        }
    };

    const handleUseOriginal = async () => {
        if (!imageDataUrl) return;

        setIsSaving(true);
        try {
            // Convert data URL to blob
            const response = await fetch(imageDataUrl);
            const blob = await response.blob();
            await onSave(blob);
        } catch (e) {
            console.error(e);
            alert("Error saving original image");
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen || !imageDataUrl) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <h3 className="text-lg font-bold text-gray-800">Edit Image</h3>
                    <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
                        ✕
                    </button>
                </div>

                {/* Cropper Area - Force explicit min-height */}
                <div className="relative flex-1 bg-gray-900 min-h-[400px]">
                    <Cropper
                        key={aspect === null ? 'free' : `aspect-${aspect}`}
                        image={imageDataUrl}
                        crop={crop}
                        zoom={zoom}
                        {...(aspect !== null ? { aspect } : {})}
                        onCropChange={setCrop}
                        onCropComplete={onCropComplete}
                        onZoomChange={setZoom}
                        objectFit="contain"
                        restrictPosition={false}
                        mediaProps={{
                            className: "max-w-none"
                        }}
                    />
                </div>

                {/* Controls */}
                <div className="p-4 border-t bg-gray-50 flex flex-col gap-4">

                    {/* Aspect Ratio Controls */}
                    <div className="flex items-center gap-4">
                        <span className="text-sm font-medium text-gray-600 w-12">Ratio</span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setAspect(null)}
                                className={`px-3 py-1 text-xs rounded border ${aspect === null ? 'bg-blue-100 border-blue-500 text-blue-700 font-bold' : 'bg-white border-gray-300 text-gray-700'}`}
                            >
                                Free
                            </button>
                            <button
                                onClick={() => setAspect(1)}
                                className={`px-3 py-1 text-xs rounded border ${aspect === 1 ? 'bg-blue-100 border-blue-500 text-blue-700 font-bold' : 'bg-white border-gray-300 text-gray-700'}`}
                            >
                                Square (1:1)
                            </button>
                            <button
                                onClick={() => setAspect(4 / 3)}
                                className={`px-3 py-1 text-xs rounded border ${aspect === 4 / 3 ? 'bg-blue-100 border-blue-500 text-blue-700 font-bold' : 'bg-white border-gray-300 text-gray-700'}`}
                            >
                                Standard (4:3)
                            </button>
                            <button
                                onClick={() => setAspect(16 / 9)}
                                className={`px-3 py-1 text-xs rounded border ${aspect === 16 / 9 ? 'bg-blue-100 border-blue-500 text-blue-700 font-bold' : 'bg-white border-gray-300 text-gray-700'}`}
                            >
                                Wide (16:9)
                            </button>
                            <button
                                onClick={() => setAspect(3 / 4)}
                                className={`px-3 py-1 text-xs rounded border ${aspect === 3 / 4 ? 'bg-blue-100 border-blue-500 text-blue-700 font-bold' : 'bg-white border-gray-300 text-gray-700'}`}
                            >
                                Portrait (3:4)
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <span className="text-sm font-medium text-gray-600 w-12">Zoom</span>
                        <input
                            type="range"
                            value={zoom}
                            min={0.1} // Allow zooming out more
                            max={3}
                            step={0.1}
                            aria-labelledby="Zoom"
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    <div className="flex justify-between items-center gap-3">
                        <button
                            onClick={handleUseOriginal}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                            disabled={isSaving}
                            title="Save the pasted image without cropping"
                        >
                            Use Original (No Crop)
                        </button>
                        <div className="flex gap-3">
                            <button
                                onClick={onCancel}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                                disabled={isSaving}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="px-6 py-2 text-sm font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {isSaving ? (
                                    <>
                                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Saving...
                                    </>
                                ) : (
                                    'Crop & Insert'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
