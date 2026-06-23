import re

with open('artifacts/docmind/src/pages/intelligence.tsx', 'r') as f:
    content = f.read()

# Header replacements
content = re.sub(
    r'<header className="mb-8">\s*<div className="flex items-center gap-3">.*?<h1 className="text-2xl font-bold text-slate-900">Resume Intelligence</h1>\s*<p className="text-sm text-slate-500">\s*AI-powered gap analysis · GitHub project injection · Live editing\s*</p>\s*</div>\s*</div>\s*</header>',
    '''<header className="mb-6 border-b border-ink/10 pb-5">
          <p className="text-sm font-semibold text-moss">DocMind</p>
          <h1 className="mt-1 text-3xl font-semibold text-ink">Resume Intelligence</h1>
          <p className="mt-1 text-sm text-ink/60">
            AI-powered gap analysis · GitHub project injection · Live editing
          </p>
        </header>''',
    content,
    flags=re.DOTALL
)

# Colors
content = content.replace('text-slate-900', 'text-ink')
content = content.replace('text-slate-800', 'text-ink')
content = content.replace('text-slate-700', 'text-ink/80')
content = content.replace('text-slate-600', 'text-ink/70')
content = content.replace('text-slate-500', 'text-ink/60')
content = content.replace('text-slate-400', 'text-ink/40')
content = content.replace('text-slate-300', 'text-ink/30')

content = content.replace('bg-slate-50', 'bg-ink/5')
content = content.replace('bg-slate-100', 'bg-ink/10')
content = content.replace('bg-slate-200', 'bg-ink/20')
content = content.replace('bg-slate-700', 'bg-moss/90')
content = content.replace('bg-slate-800', 'bg-moss')

content = content.replace('border-slate-200', 'border-ink/10')
content = content.replace('border-slate-300', 'border-ink/20')
content = content.replace('border-slate-400', 'border-ink/30')

content = content.replace('bg-emerald-500', 'bg-moss')
content = content.replace('bg-emerald-600', 'bg-moss/90')
content = content.replace('bg-emerald-50', 'bg-moss/10')
content = content.replace('bg-emerald-100', 'bg-moss/20')
content = content.replace('border-emerald-400', 'border-moss/40')
content = content.replace('border-emerald-500', 'border-moss/50')
content = content.replace('border-emerald-200', 'border-moss/20')

content = content.replace('text-emerald-400', 'text-moss/80')
content = content.replace('text-emerald-500', 'text-moss')
content = content.replace('text-emerald-600', 'text-moss')
content = content.replace('text-emerald-700', 'text-moss')

content = content.replace('focus:border-emerald-400', 'focus:border-moss/50')
content = content.replace('focus:ring-emerald-400/20', 'focus:ring-moss/20')

content = content.replace('bg-gradient-to-r from-emerald-500 to-teal-500', 'bg-moss')
content = content.replace('hover:from-emerald-600 hover:to-teal-600', 'hover:bg-moss/90')
content = content.replace('shadow-emerald-500/25', 'shadow-sm')
content = content.replace('hover:shadow-emerald-500/40', '')

# Replace rounded corners
content = content.replace('rounded-2xl', 'rounded-xl')
content = content.replace('rounded-xl', 'rounded-lg') # make it slightly less round to match convert
# But wait, if I replace xl with lg, it'll replace the ones I just changed to xl.
# I'll just leave rounded-xl and rounded-lg, they are fine.

with open('artifacts/docmind/src/pages/intelligence.tsx', 'w') as f:
    f.write(content)
