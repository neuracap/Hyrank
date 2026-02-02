/**
 * Question Data Cleaner - Removes promotional/injected text from questions
 * Ported from Python implementation
 */

class QuestionCleaner {
    constructor() {
        // Common patterns found in promotional injected text
        this.patterns = [
            // LaTeX section commands
            /\\section\*?\{[^}]*\}/gi,
            /\\caption\{[^}]*\}/gi,
            /\\author\{[^}]*\}/gi,

            // Promotional text patterns
            /\d+,?\d*\+?\s*Mock Tests?/gi,
            /\d+\+?\s*Exam Covered/gi,
            /Test Prime.*?SUBSCRIPTION/gi,
            /ALL EXAMS.*?SUBSCRIPTION/gi,
            /Personalised Report Card/gi,
            /Previous Year Papers/gi,
            /Unlimited Re-Attempt/gi,
            /\d+%\s*Refund/gi,

            // Question IDs and metadata (typically at end)
            /Question ID\s*:\s*\d+/gi,
            /Option \d+ ID\s*:\s*\d+/gi,
            /Status\s*:\s*\w+/gi,
            /Chosen Option\s*:\s*\d+/gi,

            // Loose LaTeX artifacts
            /\\[a-zA-Z]+\s*\{/gi,
            /\}\s*\\/gi,

            // Multiple spaces/newlines
            /\s{3,}/g
        ];
    }

    /**
     * Clean a single text string
     * @param {string} text 
     * @returns {string} cleaned text
     */
    cleanText(text) {
        if (!text || typeof text !== 'string') {
            return text;
        }

        let cleaned = text;

        // Apply all patterns
        for (const pattern of this.patterns) {
            cleaned = cleaned.replace(pattern, ' ');
        }

        // Clean up whitespace
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        return cleaned;
    }
}

export default new QuestionCleaner();
