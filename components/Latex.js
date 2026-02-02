'use client';

import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkUnwrapImages from 'remark-unwrap-images';
import 'katex/dist/katex.min.css';

const Latex = ({ children }) => {
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        return <span className="latex-loading font-sans">{typeof children === 'string' ? children : ''}</span>;
    }

    if (!children) return null;

    const content = typeof children === 'string' ? children : String(children);

    let processedContent = content
        .replace(/\\begin\{figure\}/g, '')
        .replace(/\\end\{figure\}/g, '')
        .replace(/\\captionsetup\{.*?\}/g, '')
        .replace(/\\caption\{(.*?)\}/g, '\n*$1*\n')
        .replace(/\\includegraphics(?:\[.*?\])?\{(.*?)\}/g, '![]($1)')
        .replace(/\\begin\{tabular\}\{.*?\}([\s\S]*?)\\end\{tabular\}/g, (match, tableContent) => {
            const cleanContent = tableContent.replace(/\\hline/g, '').trim();
            const rows = cleanContent.split(/\\\\/);

            const headerCells = rows[0].split('&').map(c => c.trim());
            if (headerCells.length === 0) return match;

            let mdTable = '| ' + headerCells.join(' | ') + ' |\n';
            mdTable += '| ' + headerCells.map(() => '---').join(' | ') + ' |\n';

            for (let i = 1; i < rows.length; i++) {
                const cells = rows[i].split('&').map(c => c.trim());
                if (cells.length === 0 || (cells.length === 1 && cells[0] === '')) continue;
                mdTable += '| ' + cells.join(' | ') + ' |\n';
            }
            return '\n' + mdTable + '\n';
        })
        .replace(/\\\((.*?)\\\)/g, '$$$1$$')
        .replace(/\\\[(.*?)\\\]/g, '$$$$$1$$$$')
    // Heuristics removed to avoid double-wrapping content already fixed by LLM
    // .replace(/(\d+\^\{[^}]+\})/g, '$$$1$$')
    // .replace(/(\\frac\{(?:[^{}]|\{[^}]*\})+\}\{(?:[^{}]|\{[^}]*\})+\})/g, '$$$1$$')
    // .replace(/(\\sqrt\{[^}]+\})/g, '$$$1$$')
    // .replace(/(\d+\^\{[^}]+\}(\s*[\+\-\*]\s*\d+\^\{[^}]+\})+)/g, '$$$1$$');

    processedContent = processedContent.replace(/\\n/g, '\n');

    const ImageRenderer = ({ src, alt, ...props }) => {
        let realSrc = src;
        if (src && (src.startsWith('./images/') || src.startsWith('images/') || src.includes('/images/'))) {
            const filename = src.split('/').pop();
            realSrc = `/api/assets?name=${encodeURIComponent(filename)}`;
        }

        return (
            <div className="flex flex-col items-center my-4">
                <img
                    src={realSrc}
                    alt={alt}
                    className="max-h-96 object-contain rounded border border-gray-100"
                    {...props}
                    onError={(e) => {
                        e.target.style.display = 'none';
                    }}
                />
            </div>
        );
    };

    return (
        <div className="latex-container prose prose-sm max-w-none text-gray-800">
            <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm, remarkUnwrapImages]}
                rehypePlugins={[rehypeKatex]}
                components={{
                    p: ({ node, ...props }) => <p className="mb-2 leading-relaxed" {...props} />,
                    img: ImageRenderer,
                    table: ({ node, ...props }) => <table style={{ borderCollapse: 'collapse', width: '100%', margin: '1rem 0', border: '1px solid #d1d5db' }} className="border-collapse border border-gray-300 my-4 w-full text-sm" {...props} />,
                    thead: ({ node, ...props }) => <thead className="bg-gray-50" {...props} />,
                    th: ({ node, ...props }) => <th style={{ border: '1px solid #d1d5db', padding: '0.5rem' }} className="border border-gray-300 px-3 py-2 font-semibold text-left" {...props} />,
                    td: ({ node, ...props }) => <td style={{ border: '1px solid #d1d5db', padding: '0.5rem' }} className="border border-gray-300 px-3 py-2" {...props} />
                }}
            >
                {processedContent}
            </ReactMarkdown>
        </div>
    );
};

export default Latex;
