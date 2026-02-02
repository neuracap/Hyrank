import sys
from deep_translator import GoogleTranslator
import re

def translate_text(text, source='auto', target='en'):
    if not text or not text.strip():
        return ""

    # Protect LaTeX and other patterns
    placeholders = []
    
    def replacer(match):
        placeholders.append(match.group(0))
        return f"__LATEX_{len(placeholders)-1}__"

    # Regex patterns
    # 1. LaTeX inline math \( ... \) or $ ... $ (basic)
    # 2. LaTeX block math \[ ... \]
    # 3. LaTeX commands like \section{...} or \frac{...}{...} - tough to catch all, 
    #    but we can catch basic \word or \word{...}
    # 4. Image tags we just added \includegraphics{...}
    
    # Simple strategy: Protect anything starting with \ until space or special char, 
    # OR protects enclosed bits.
    # Actually, simpler: protect common patterns we know we use.
    
    # 1. \includegraphics{...}
    # 2. $...$
    # 3. \(...\)
    # 4. \[...\]
    
    patterns = [
        r'\\includegraphics\{[^}]+\}',     # images
        r'\$[^$]+\$',                      # $ math $
        r'\\\([^\)]+\\\)',                 # \( math \)
        r'\\\[[^\]]+\\\]',                 # \[ math \]
        r'\\[a-zA-Z]+(\{[^}]*\})?'         # \command or \command{arg} - cautious here
    ]
    
    # Iterate and replace
    protected_text = text
    for pattern in patterns:
        protected_text = re.sub(pattern, replacer, protected_text)

    # Translate
    try:
        # GoogleTranslator usually robust
        translated = GoogleTranslator(source=source, target=target).translate(protected_text)
    except Exception as e:
        return f"Error: {str(e)}"

    # Restore placeholders
    # Google Translate might mess up spacing or capitalization of placeholders like __LATEX_0__ becomes __Latex_0__
    # We need robust restoration.
    
    def restore(match):
        idx = int(match.group(1))
        if 0 <= idx < len(placeholders):
            return placeholders[idx]
        return match.group(0)

    # Regex to find placeholders even if mangled slightly (e.g. spaces added)
    # Case insensitive for LATEX part
    restored_text = re.sub(r'__LATEX_(\d+)__', restore, translated, flags=re.IGNORECASE)
    
    return restored_text

if __name__ == "__main__":
    # Force UTF-8 for Windows
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stdin.reconfigure(encoding='utf-8')

    # Check if input is coming from stdin (piping or redirection)
    if not sys.stdin.isatty():
        import json
        try:
            input_data = sys.stdin.read()
            # Try to parse as JSON first
            try:
                data = json.loads(input_data)
                text = data.get('text', '')
                source = data.get('source', 'auto')
                target = data.get('target', 'en')
            except json.JSONDecodeError:
                # Fallback: assume raw text passed via stdin, read args for langs
                text = input_data
                source = sys.argv[1] if len(sys.argv) > 1 else 'auto'
                target = sys.argv[2] if len(sys.argv) > 2 else 'en'
            
            print(translate_text(text, source, target))
            
        except Exception as e:
            print(f"Error: {str(e)}")
    else:
        # Fallback to argv
        if len(sys.argv) < 4:
            print("Usage: python translate_text.py <src> <tgt> <text> OR echo 'json' | python translate_text.py")
            sys.exit(1)
            
        source_lang = sys.argv[1]
        target_lang = sys.argv[2]
        text = sys.argv[3]
        
        print(translate_text(text, source_lang, target_lang))
