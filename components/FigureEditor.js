'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Lightweight canvas image editor for drawing on figures.
 * Tools: Pen, Line, Text, Eraser, Color picker, Undo
 *
 * Props:
 *   imageUrl - the source image to edit
 *   onSave(blob) - called with the edited image as a Blob
 *   onClose() - close the editor
 */
export default function FigureEditor({ imageUrl, onSave, onClose }) {
    const canvasRef = useRef(null);
    const [tool, setTool] = useState('pen');
    const [color, setColor] = useState('#ff0000');
    const [lineWidth, setLineWidth] = useState(2);
    const [isDrawing, setIsDrawing] = useState(false);
    const [lineStart, setLineStart] = useState(null);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [saving, setSaving] = useState(false);

    // Load image onto canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !imageUrl) return;
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const maxW = Math.min(800, window.innerWidth - 100);
            const scale = Math.min(maxW / img.width, 600 / img.height, 1);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const initial = ctx.getImageData(0, 0, canvas.width, canvas.height);
            setHistory([initial]);
            setHistoryIndex(0);
        };
        img.src = imageUrl;
    }, [imageUrl]);

    const pushState = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const state = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setHistory(prev => {
            const newH = prev.slice(0, historyIndex + 1);
            newH.push(state);
            if (newH.length > 30) newH.shift();
            return newH;
        });
        setHistoryIndex(prev => Math.min(prev + 1, 30));
    }, [historyIndex]);

    const undo = () => {
        if (historyIndex <= 0) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(history[historyIndex - 1], 0, 0);
        setHistoryIndex(historyIndex - 1);
    };

    const getPos = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const source = e.touches ? e.touches[0] : e;
        return {
            x: (source.clientX - rect.left) * scaleX,
            y: (source.clientY - rect.top) * scaleY,
        };
    };

    const handleDown = (e) => {
        e.preventDefault();
        const pos = getPos(e);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        if (tool === 'text') {
            const text = prompt('Enter text:');
            if (!text) return;
            ctx.font = `bold ${Math.max(14, lineWidth * 6)}px sans-serif`;
            ctx.fillStyle = color;
            ctx.fillText(text, pos.x, pos.y);
            pushState();
            return;
        }

        if (tool === 'line') {
            setLineStart(pos);
            setIsDrawing(true);
            return;
        }

        setIsDrawing(true);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
        ctx.lineWidth = tool === 'eraser' ? lineWidth * 5 : lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    };

    const handleMove = (e) => {
        if (!isDrawing) return;
        e.preventDefault();
        const pos = getPos(e);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        if (tool === 'line') {
            if (historyIndex >= 0 && history[historyIndex]) {
                ctx.putImageData(history[historyIndex], 0, 0);
            }
            ctx.beginPath();
            ctx.moveTo(lineStart.x, lineStart.y);
            ctx.lineTo(pos.x, pos.y);
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.stroke();
            return;
        }

        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    };

    const handleUp = () => {
        if (!isDrawing) return;
        setIsDrawing(false);
        setLineStart(null);
        pushState();
    };

    const handleSave = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        setSaving(true);
        try {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            await onSave(blob);
        } catch (e) {
            alert('Failed to save: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const tools = [
        { key: 'pen', label: 'Pen', icon: '✏️' },
        { key: 'line', label: 'Line', icon: '📏' },
        { key: 'text', label: 'Text', icon: 'T' },
        { key: 'eraser', label: 'Eraser', icon: '⬜' },
    ];

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="bg-white rounded-lg shadow-2xl max-w-[900px] w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Toolbar */}
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 flex-wrap">
                    {tools.map(t => (
                        <button key={t.key} onClick={() => setTool(t.key)}
                            className={`px-2 py-1 text-xs font-semibold rounded border transition-colors ${tool === t.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}>
                            <span className="mr-0.5">{t.icon}</span>{t.label}
                        </button>
                    ))}
                    <div className="w-px h-5 bg-gray-300 mx-0.5" />
                    <input type="color" value={color} onChange={e => setColor(e.target.value)}
                        className="w-6 h-6 rounded border border-gray-300 cursor-pointer" title="Color" />
                    <select value={lineWidth} onChange={e => setLineWidth(parseInt(e.target.value))}
                        className="text-xs border border-gray-300 rounded px-1 py-0.5">
                        <option value="1">1px</option>
                        <option value="2">2px</option>
                        <option value="4">4px</option>
                        <option value="6">6px</option>
                        <option value="8">8px</option>
                    </select>
                    <div className="w-px h-5 bg-gray-300 mx-0.5" />
                    <button onClick={undo} disabled={historyIndex <= 0}
                        className="px-2 py-1 text-xs font-semibold bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40">
                        Undo
                    </button>
                    <div className="ml-auto flex gap-1.5">
                        <button onClick={handleSave} disabled={saving}
                            className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save & Upload'}
                        </button>
                        <button onClick={onClose}
                            className="px-3 py-1 text-xs font-semibold bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                            Cancel
                        </button>
                    </div>
                </div>

                {/* Canvas */}
                <div className="flex-1 overflow-auto p-3 flex items-center justify-center bg-gray-100 min-h-[300px]">
                    <canvas
                        ref={canvasRef}
                        className="border border-gray-300 shadow-sm bg-white"
                        style={{ maxWidth: '100%', cursor: tool === 'text' ? 'text' : 'crosshair', touchAction: 'none' }}
                        onMouseDown={handleDown}
                        onMouseMove={handleMove}
                        onMouseUp={handleUp}
                        onMouseLeave={() => { if (isDrawing) { setIsDrawing(false); pushState(); } }}
                        onTouchStart={handleDown}
                        onTouchMove={handleMove}
                        onTouchEnd={handleUp}
                    />
                </div>
            </div>
        </div>
    );
}
