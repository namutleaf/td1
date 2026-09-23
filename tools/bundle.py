"""index.html + style.css + src/*.js 를 한 파일로 묶는다 (웹 공유/폰 테스트용).

사용: python3 tools/bundle.py [출력경로]   (기본: dist/maze-hero-td.html)
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPTS = ['src/config.js', 'src/board.js', 'src/game.js']

html = (ROOT / 'index.html').read_text(encoding='utf-8')
body = html.split('<body>')[1].split('<script')[0]
css = (ROOT / 'style.css').read_text(encoding='utf-8')
js = '\n'.join((ROOT / f).read_text(encoding='utf-8') for f in SCRIPTS)

out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'dist' / 'maze-hero-td.html'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(f'<title>미로 영웅 TD</title>\n<style>\n{css}\n</style>\n{body}<script>\n{js}\n</script>\n', encoding='utf-8')
print(out)
