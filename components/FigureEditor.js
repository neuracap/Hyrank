'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

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

    // Select tool state
    const [selectRect, setSelectRect] = useState(null); // { x, y, w, h }
    const [selectData, setSelectData] = useState(null); // ImageData of selected region
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState(null);
    const [selectOrigin, setSelectOrigin] = useState(null);

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
        setSelectRect(null);
        setSelectData(null);
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

    // Commit the selected region to its current position (finalize move)
    const commitSelection = () => {
        if (!selectRect || !selectData) return;
        // Already drawn on canvas via handleMove, just push state
        pushState();
        setSelectRect(null);
        setSelectData(null);
        setIsDragging(false);
    };

    const handleDown = (e) => {
        e.preventDefault();
        const pos = getPos(e);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        // SELECT tool
        if (tool === 'select') {
            // If we have a selection and clicking inside it, start dragging
            if (selectRect && selectData) {
                const r = selectRect;
                if (pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h) {
                    setIsDragging(true);
                    setDragOffset({ x: pos.x - r.x, y: pos.y - r.y });
                    return;
                }
                // Clicking outside — commit current selection and start new one
                commitSelection();
            }
            // Start new selection rectangle
            setSelectOrigin(pos);
            setIsDrawing(true);
            setSelectRect(null);
            setSelectData(null);
            return;
        }

        // If switching away from select, commit any pending selection
        if (selectRect && selectData) commitSelection();

        if (tool === 'picker') {
            const pixel = ctx.getImageData(Math.round(pos.x), Math.round(pos.y), 1, 1).data;
            const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(c => c.toString(16).padStart(2, '0')).join('');
            setColor(hex);
            setTool('pen'); // switch back to pen after picking
            return;
        }

        if (tool === 'text') {
            const text = prompt('Enter text:');
            if (!text) return;
            ctx.font = `bold ${Math.max(10, lineWidth * 4)}px sans-serif`;
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
        if (!isDrawing && !isDragging) return;
        e.preventDefault();
        const pos = getPos(e);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        // SELECT: dragging the selected region
        if (tool === 'select' && isDragging && selectData && selectRect) {
            const newX = pos.x - dragOffset.x;
            const newY = pos.y - dragOffset.y;
            // Restore canvas to state before selection was moved
            if (historyIndex >= 0 && history[historyIndex]) {
                ctx.putImageData(history[historyIndex], 0, 0);
            }
            // Draw the selected region at new position
            ctx.putImageData(selectData, newX, newY);
            setSelectRect({ ...selectRect, x: newX, y: newY });
            return;
        }

        // SELECT: drawing selection rectangle
        if (tool === 'select' && isDrawing && selectOrigin) {
            if (historyIndex >= 0 && history[historyIndex]) {
                ctx.putImageData(history[historyIndex], 0, 0);
            }
            const x = Math.min(selectOrigin.x, pos.x);
            const y = Math.min(selectOrigin.y, pos.y);
            const w = Math.abs(pos.x - selectOrigin.x);
            const h = Math.abs(pos.y - selectOrigin.y);
            ctx.strokeStyle = '#0088ff';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
            return;
        }

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

    const handleUp = (e) => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        // SELECT: finish drawing selection rect
        if (tool === 'select' && isDrawing && selectOrigin) {
            const pos = getPos(e);
            const x = Math.min(selectOrigin.x, pos.x);
            const y = Math.min(selectOrigin.y, pos.y);
            const w = Math.abs(pos.x - selectOrigin.x);
            const h = Math.abs(pos.y - selectOrigin.y);
            setIsDrawing(false);
            setSelectOrigin(null);

            if (w > 3 && h > 3) {
                // Restore canvas, capture selected region, then erase it from canvas
                if (historyIndex >= 0 && history[historyIndex]) {
                    ctx.putImageData(history[historyIndex], 0, 0);
                }
                const data = ctx.getImageData(x, y, w, h);
                setSelectData(data);
                // Fill the original area with white (cut)
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(x, y, w, h);
                // Draw the selected region back (so it looks the same)
                ctx.putImageData(data, x, y);
                setSelectRect({ x, y, w, h });
                // Save the state with the white hole (for dragging restore)
                const stateWithHole = ctx.getImageData(0, 0, canvas.width, canvas.height);
                // We need to save the "hole" state so dragging restores correctly
                // Override current history entry with the hole state
                ctx.fillRect(x, y, w, h); // erase again
                const holeState = ctx.getImageData(0, 0, canvas.width, canvas.height);
                ctx.putImageData(data, x, y); // put it back visually
                setHistory(prev => {
                    const newH = [...prev.slice(0, historyIndex + 1)];
                    newH.push(holeState);
                    return newH;
                });
                setHistoryIndex(prev => prev + 1);
            }
            return;
        }

        // SELECT: finish dragging
        if (tool === 'select' && isDragging) {
            setIsDragging(false);
            setDragOffset(null);
            return;
        }

        if (!isDrawing) return;
        setIsDrawing(false);
        setLineStart(null);
        pushState();
    };

    const handleSave = async () => {
        // Commit any pending selection before saving
        if (selectRect && selectData) commitSelection();
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

    const getCursor = () => {
        if (tool === 'text') return 'text';
        if (tool === 'picker') return 'copy';
        if (tool === 'select') {
            if (selectRect && !isDragging) return 'move';
            return 'crosshair';
        }
        return 'crosshair';
    };

    const tools_ = [
        { key: 'pen', label: 'Pen', icon: '✏️' },
        { key: 'line', label: 'Line', icon: '📏' },
        { key: 'text', label: 'Text', icon: 'T' },
        { key: 'select', label: 'Select & Move', icon: '⬚' },
        { key: 'eraser', label: 'Eraser', icon: '⬜' },
        { key: 'picker', label: 'Pick Color', icon: '💧' },
    ];

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="bg-white rounded-lg shadow-2xl max-w-[900px] w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 flex-wrap">
                    {tools_.map(t => (
                        <button key={t.key} onClick={() => { setTool(t.key); if (t.key !== 'select' && selectRect && selectData) commitSelection(); }}
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
                        <option value="3">3px</option>
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

                {selectRect && (
                    <div className="px-3 py-1 bg-blue-50 border-b text-xs text-blue-700">
                        Selection active — click inside to drag, click outside to place, or switch tool to commit.
                    </div>
                )}

                <div className="flex-1 overflow-auto p-3 flex items-center justify-center bg-gray-100 min-h-[300px]">
                    <canvas
                        ref={canvasRef}
                        className="border border-gray-300 shadow-sm bg-white"
                        style={{ maxWidth: '100%', cursor: getCursor(), touchAction: 'none' }}
                        onMouseDown={handleDown}
                        onMouseMove={handleMove}
                        onMouseUp={handleUp}
                        onMouseLeave={() => {
                            if (isDrawing && tool !== 'select') { setIsDrawing(false); pushState(); }
                        }}
                        onTouchStart={handleDown}
                        onTouchMove={handleMove}
                        onTouchEnd={handleUp}
                    />
                </div>
            </div>
        </div>
    );
}
