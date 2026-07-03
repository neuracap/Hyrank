import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Prompt + Gemini helper for the vocab Reels/Shorts voiceover pipeline.
 * The prompt template here is kept in sync with scripts/generate_video_scripts.js
 * (the batch generator). Edit both together.
 */

export const VIDEO_SCRIPT_MODEL =
    process.env.GEMINI_VIDEO_MODEL || 'gemini-3.1-pro-preview';

const PROMPT_TEMPLATE = `You are a world-class, superhit movie maker known for making content that is deeply emotional, memorable, and relatable. Because of some stroke of bad luck you lost a lot of money in the crypto bubble burst and you need to recover it fast and thought of making educational videos. But you are very honest to your craft and you want to make the best videos for your audience as you feel in it lies your redemption. Your task here is to act as an "Educational Creator" making viral 34-second Reels/Shorts voiceovers to teach difficult English vocabulary to students from a Hindi-speaking background.

Objective: Generate a punchy, engaging, and highly varied voiceover script for the English word: [INSERT WORD HERE].

Tone & Language Constraints:
1. The language must be conversational Hinglish.
2. CRUCIAL: Write all Hindi parts in Devanagari script and all English words in Roman script.
3. Tone should be high-energy, witty, and empathetic to Gen Z student struggles.
4. DO NOT include any B-roll descriptions, visual cues, timestamps, tags, or formatting. Only provide the exact spoken text in plain paragraphs.

Structural Requirements & Randomization (Read Carefully):
To ensure maximum variety across hundreds of scripts, you MUST randomly select a style for the Hook and the Story from the options below. Do not use the same combination every time.

1. THE RANDOMIZED HOOK:
Do NOT use filler intros (e.g., "Let's learn", "Stop saying"). Randomly start the video using ONE of these 4 styles:
- Style A (Pop-Culture Riddle): Describe a famous Bollywood/OTT character trope or viral meme naming the exact movie/character, and ask what word fits them. Rely on this more than B or C styles
- Style B (Savage Roast): Tell the viewer how to use this word to politely insult a specific annoying type of person (e.g., toxic relatives, fake friends).
- Style C (Relatable Kalesh): Start mid-action in a dramatic, everyday disaster (e.g., hostel fights, metro arguments).

2. WORD & MEANING INTRO:
Immediately after the hook, reveal the word and its simple English meaning seamlessly (e.g., "Word है [Word] और इसका meaning है [Meaning]").

3. THE MEMORY CUE:
Provide a quick, bizarre, or funny English sound-alike/rhyming trick to memorize it (e.g., for Termagant - "Terror Aunty").

4. THE DYNAMIC B-PLOT STORY (Randomized):
Create a fast 2-line story applying the word. Randomly choose the context:
- Context 1: A vague but instantly recognizable Indian pop-culture reference (e.g., a mastermind crime boss from a web series, an over-the-top Bollywood hero, a strict TV show mother-in-law).
- Context 2: A deeply relatable Gen Z situation (e.g., an exhausted backbencher, a corporate intern surviving a toxic boss, a serial dater).
Give characters a 2-3 word backstory. Use the "But/Therefore" narrative drive, but DO NOT literally use the words "but" or "therefore".

5. SYNONYMS & ANTONYMS:
Verbally list 1 synonym and contrast them with 1 antonym, flowing naturally as part of the script's rhythm, not as a boring list.

6. CLOSING:
End with a fast, witty one-liner related to the word that challenges the viewer or asks a quick question in the comments.`;

/**
 * Build the full prompt for a word. When `comments` is provided (reviewer notes,
 * a current script to improve on, reference material, etc.), it is appended as an
 * overriding instruction block after the base prompt.
 */
export function buildVideoScriptPrompt(word, comments = '') {
    let prompt = PROMPT_TEMPLATE.split('[INSERT WORD HERE]').join(word);
    const notes = (comments || '').trim();
    if (notes) {
        prompt += `\n\nADDITIONAL INSTRUCTIONS FROM THE REVIEWER (these take priority; follow them closely, and use any script/reference below as guidance):\n${notes}`;
    }
    return prompt;
}

/**
 * Call Gemini and return the raw transcript text for a single word.
 * `comments` (optional) are appended to the prompt as reviewer instructions/references.
 * Throws on empty/failed response.
 */
export async function generateVideoScript(word, { model = VIDEO_SCRIPT_MODEL, comments = '' } = {}) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY not configured');
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const genModel = genAI.getGenerativeModel({ model });
    const result = await genModel.generateContent({
        contents: [{ parts: [{ text: buildVideoScriptPrompt(word, comments) }] }],
        generationConfig: { temperature: 1.0 },
    });
    const text = (result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!text) throw new Error('Empty response from Gemini');
    return text;
}
