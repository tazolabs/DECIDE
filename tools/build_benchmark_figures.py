#!/usr/bin/env python3
"""Build brand-styled, self-contained SVG figures from published DECIDE totals.

Only public aggregate counts appear here. No private dataset is read.
Text is outlined using the bundled OFL fonts, so GitHub and browsers render it alike.
"""
from pathlib import Path
from html import escape
import math
import re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'site/assets/figures'
FONTS = ROOT / 'site/assets/fonts'
PAPER, INK, TEAL, STRONG = '#f6f9f9', '#071416', '#00897b', '#067468'
MUTED, LINE, SOFT = '#4e6061', '#d9e1e1', '#e8eeee'
FAMILIES = [
    ('Business & conversation', 1403, 'Interest, availability and caller intent', 'business'),
    ('Graph routing', 743, 'The next action and graph node', 'graph'),
    ('Tool decisions', 128, 'External-tool choice and readiness', 'tool'),
    ('Turn taking', 376, 'Who should speak next, or end the call', 'turn'),
    ('Voice properties', 1886, 'Emotion, speakers and disturbance', 'voice'),
    ('Language switching', 331, 'Changes in the spoken language', 'language'),
]
assert sum(row[1] for row in FAMILIES) == 4867

class Figure:
    def __init__(self, width, height, title, description):
        self.width, self.height = width, height
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
                      f'<title id="title">{escape(title)}</title><desc id="desc">{escape(description)}</desc>',
                      f'<rect width="{width}" height="{height}" fill="{PAPER}"/>']

    def rect(self, x, y, w, h, fill=SOFT, stroke='none', radius=0):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}"/>')

    def line(self, x1, y1, x2, y2, color=LINE, width=1):
        self.parts.append(f'<path d="M{x1},{y1}H{x2}" fill="none" stroke="{color}" stroke-width="{width}"/>' if y1 == y2 else f'<path d="M{x1},{y1}L{x2},{y2}" fill="none" stroke="{color}" stroke-width="{width}"/>')

    def text(self, x, y, value, size=18, face='body', color=INK, anchor='start'):
        font, glyphs, cmap, units = faces[face]
        scale = size / units
        advance = sum(glyphs[cmap[ord(c)]].width for c in value)
        if anchor == 'end': x -= advance * scale
        if anchor == 'middle': x -= advance * scale / 2
        pen = SVGPathPen(glyphs)
        cursor = 0
        for char in value:
            glyph = glyphs[cmap[ord(char)]]
            glyph.draw(TransformPen(pen, (1, 0, 0, 1, cursor, 0)))
            cursor += glyph.width
        self.parts.append(f'<path aria-hidden="true" fill="{color}" transform="translate({x:.3f},{y}) scale({scale:.6f}, {-scale:.6f})" d="{pen.getCommands()}"/>')

    def icon(self, x, y, kind, size=30):
        # Original line icons, drawn in the Tazo ink/teal palette.
        paths = {
            'business': 'M4 4h24v17H16l-7 7v-7H4z M10 10h12 M10 15h8',
            'graph': 'M7 6h18 M7 6v19h18 M25 6v19',
            'tool': 'M21 4a8 8 0 0 0-9 10L4 23l5 5 9-9a8 8 0 0 0 10-9l-6 5-5-5z',
            'turn': 'M4 10h23l-6-6 M28 22H5l6 6',
            'voice': 'M4 13v6 M10 7v18 M16 3v26 M22 9v14 M28 13v6',
            'language': 'M3 7h16 M11 3v4 M6 7c0 9 10 14 12 14 M17 7c0 6-5 12-12 15 M19 28l5-14 5 14 M21 23h6',
        }
        self.parts.append(f'<g transform="translate({x},{y}) scale({size / 32})" fill="none" stroke="{INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="{paths[kind]}"/></g>')
        if kind == 'graph':
            for px, py in [(7, 6), (25, 6), (7, 25), (25, 25)]:
                self.parts.append(f'<circle cx="{x + px * size/32}" cy="{y + py * size/32}" r="{size/10}" fill="{TEAL}"/>')

    def wave(self, x, y, w, h):
        points = []
        for i in range(240):
            t = i / 239
            envelope = sum(a * math.exp(-((t-c)/s)**2) for c,a,s in [(0.18,.6,.05),(.37,1,.09),(.64,.7,.07),(.82,.9,.04)])
            dy = h * .46 * envelope * math.sin(i * 1.9) * math.sin(i * .23 + .2)
            points.append(f'{x+t*w:.2f},{y+dy:.2f}')
        self.parts.append(f'<polyline points="{" ".join(points)}" stroke="{TEAL}" stroke-width="1.6" fill="none"/>')

    def save(self, name):
        (OUT / name).write_text('\n'.join(self.parts + ['</svg>']) + '\n')


def load_face(filename, weight=None):
    font = TTFont(FONTS / filename)
    glyphs = font.getGlyphSet(location={'wght': weight} if weight else None)
    return font, glyphs, font.getBestCmap(), font['head'].unitsPerEm

faces = {
    'display': load_face('hanken-grotesk-latin.woff2', 600),
    'body': load_face('inter-latin.woff2', 400),
    'mono': load_face('ibm-plex-mono-medium.woff2'),
}


def overview(mobile=False):
    desc = ('Schematic of DECIDE: short clips from production calls, permitted earlier context and candidate decisions yield one decision at the clip boundary. '
            'Six families cover business and conversation, graph routing, tool decisions, turn taking, voice properties and language switching. '
            'Waveforms are illustrative. The benchmark has 1081 clips from 570 calls, 32 tasks and an annotation team of four.')
    f = Figure(640 if mobile else 1280, 1240 if mobile else 622, 'DECIDE benchmark overview', desc)
    if mobile:
        f.text(32, 55, 'One conversation.', 36, 'display')
        f.text(32, 98, 'Many decisions.', 36, 'display', MUTED)
        f.line(32, 130, 608, 130)
        f.text(32, 170, '01 / REAL CALLS', 17, 'mono', MUTED)
        f.text(32, 214, 'Real production conversations', 28, 'display')
        f.wave(48, 288, 544, 90)
        f.line(48, 238, 48, 338); f.line(592, 238, 592, 338)
        f.text(32, 378, '3–25 second clips. Exact audio boundaries.', 21)
        f.text(32, 418, '1,081 CLIPS / 570 CALLS', 18, 'mono', MUTED)
        f.line(32, 455, 608, 455)
        f.text(32, 494, '02 / CLIP + CONTEXT', 17, 'mono', MUTED)
        f.text(32, 538, 'Evidence for one local decision', 28, 'display')
        for y, width in [(582, 430), (603, 350), (624, 390)]: f.line(46, y, width, y, LINE, 4)
        f.text(32, 669, 'Earlier dialogue + question + candidate options', 20)
        f.rect(32, 699, 576, 61, SOFT, LINE, 6)
        f.text(320, 738, 'Choose one option at the clip boundary', 23, 'display', STRONG, 'middle')
        f.line(32, 800, 608, 800)
        f.text(32, 840, '03 / DECISION TASKS', 17, 'mono', MUTED)
        tiles = [('Business &','conversation','business'),('Graph routing','','graph'),('Tool decisions','','tool'),('Turn taking','','turn'),('Voice properties','','voice'),('Language switching','','language')]
        for i, (a,b,kind) in enumerate(tiles):
            x=32+(i%2)*300; y=884+(i//2)*95
            f.icon(x,y,kind,30);f.text(x+43,y+22,a,23,'display')
            if b: f.text(x+43,y+48,b,23,'display')
        f.line(32, 1182, 608, 1182)
        f.text(32, 1218, '32 TASKS / ANNOTATION TEAM: 4', 16, 'mono', MUTED)
    else:
        f.text(40, 44, 'DECIDE / BENCHMARK OVERVIEW', 12, 'mono', MUTED)
        f.text(40, 99, 'One conversation. Many decisions.', 38, 'display')
        f.line(40, 130, 1240, 130)
        f.line(427, 163, 427, 550); f.line(836, 163, 836, 550)
        for x, label in [(40,'01 / REAL CALLS'),(466,'02 / CLIP + CONTEXT'),(876,'03 / DECISION TASKS')]: f.text(x,171,label,12,'mono',MUTED)
        f.text(40, 211, 'Real production calls', 26, 'display')
        f.text(40, 245, 'A short slice of a real conversation.', 16, color=MUTED)
        f.wave(60, 319, 320, 95)
        f.line(60, 265, 60, 369); f.line(380, 265, 380, 369)
        f.text(60, 397, 'EXACT CLIP BOUNDARY / 3–25 s', 12, 'mono', MUTED)
        f.text(40, 455, 'Agent', 22, 'display');f.text(217, 455, 'Caller', 22, 'display')
        f.line(156,447,190,447,STRONG,1.5)
        f.line(156,447,162,441,STRONG,1.5);f.line(156,447,162,453,STRONG,1.5)
        f.line(190,447,184,441,STRONG,1.5);f.line(190,447,184,453,STRONG,1.5)
        f.text(40, 505, '1,081 clips / 570 source calls', 16)
        f.text(40, 535, 'Speech, pauses and tone.', 16, color=MUTED)
        f.text(466, 211, 'A bounded question', 26, 'display')
        f.text(466, 245, 'Permitted earlier dialogue', 16, color=MUTED)
        for y, width in [(280, 280), (298, 215), (316, 250)]: f.line(466,y,466+width,y,LINE,4)
        f.text(466, 366, 'Audio clip + conversation context', 16)
        f.text(466, 397, 'Question + candidate decisions', 16)
        f.rect(466, 431, 328, 65, SOFT, LINE, 6)
        f.text(630, 473, 'Choose one option', 25, 'display', STRONG, 'middle')
        f.text(466, 535, 'At the end of the clip.', 16, color=MUTED)
        tiles=[('Business &','conversation','business'),('Graph','routing','graph'),('Tool','decisions','tool'),('Turn','taking','turn'),('Voice','properties','voice'),('Language','switching','language')]
        for i,(a,b,kind) in enumerate(tiles):
            x=876+(i%2)*194;y=208+(i//2)*116
            f.icon(x,y,kind,26);f.text(x,y+54,a,20,'display');f.text(x,y+80,b,20,'display')
        f.line(40, 575, 1240, 575)
        f.text(40, 605, '32 TASKS', 12, 'mono', MUTED)
        f.text(305, 605, 'ANNOTATION TEAM: 4', 12, 'mono', MUTED)
        f.text(1240, 605, 'NO FUTURE DIALOGUE IN THE INPUT', 12, 'mono', MUTED, 'end')
    f.save('benchmark-overview-mobile.svg' if mobile else 'benchmark-overview.svg')


def distribution(mobile=False):
    desc='DECIDE v1.0 has 4867 decision questions: '+ '; '.join(f'{name}: {n}' for name,n,_,_ in FAMILIES)+'. Bar lengths encode question counts.'
    f=Figure(640 if mobile else 1280, 1025 if mobile else 690, 'DECIDE question distribution by decision family', desc)
    f.text(32 if mobile else 40, 57 if mobile else 54, 'What does DECIDE ask?', 35 if mobile else 38, 'display')
    f.text(32 if mobile else 40, 98 if mobile else 93, '4,867 questions across six decision families', 20 if mobile else 18, color=MUTED)
    if mobile:
        for i,(name,n,detail,kind) in enumerate(FAMILIES):
            y=164+i*128
            f.text(32,y,name,26,'display');f.text(608,y,f'{n:,}',23,'mono',INK,'end')
            f.text(32,y+33,detail,19,color=MUTED)
            f.rect(32,y+57,576,12,SOFT,radius=3);f.rect(32,y+57,576*n/2000,12,TEAL,radius=3)
        for n in [0,1000,2000]: f.text(32+576*n/2000,975,f'{n:,}',17,'mono',MUTED,'middle' if n==1000 else 'start' if n==0 else 'end')
        f.text(32,1010,'NUMBER OF QUESTIONS / DECIDE v1.0',14,'mono',MUTED)
    else:
        f.text(450,147,'NUMBER OF QUESTIONS',12,'mono',MUTED)
        for n in range(0,2001,500):
            x=450+688*n/2000;f.line(x,170,x,600,LINE,.8);f.text(x,633,f'{n:,}',13,'mono',MUTED,'middle')
        for i,(name,n,detail,kind) in enumerate(FAMILIES):
            y=192+i*73
            f.icon(40,y-19,kind,24)
            f.text(84,y,name,22,'display');f.text(84,y+26,detail,14,color=MUTED)
            f.rect(450,y-9,688,13,SOFT,radius=3);f.rect(450,y-9,688*n/2000,13,TEAL,radius=3)
            f.text(1240,y+3,f'{n:,}',20,'mono',INK,'end')
        f.line(40,660,1240,660);f.text(40,682,'QUESTION COUNTS / DECIDE v1.0',11,'mono',MUTED)
    f.save('decision-families-mobile.svg' if mobile else 'decision-families.svg')


def ridge():
    # Decorative ridge motif inspired by the supplied brand kit, not an acoustic measurement.
    f=Figure(1280,165,'Tazo ridge waveform motif','Decorative stacked line artwork inspired by the Tazo brand kit.')
    for row in reversed(range(18)):
        points=[]
        for i in range(321):
            x=i*4;t=i/320
            env=sum(a*math.exp(-((t-c)/s)**2) for c,a,s in [(.28,1,.06),(.43,.8,.07),(.6,1,.07),(.76,.6,.04)])
            height=(18+10*math.sin(t*70+row*.09)**2)*env
            y=48+row*6-height*(.6+.4*math.sin(t*98+row*.12)**2)
            points.append(f'{x:.1f},{y:.2f}')
        color=TEAL if row<3 else '#95a7a7' if row<11 else '#cbd6d6'
        f.parts.append(f'<polyline points="{" ".join(points)}" stroke="{color}" stroke-width=".8" fill="none"/>')
    f.save('ridge.svg')


def dark_variants():
    # Explicit Lagoon dark colors preserve the figures' intended semantics;
    # the light SVGs embedded in the GitHub README remain unchanged.
    palette = {
        PAPER: '#061214', INK: '#e6f2f1', TEAL: '#19c2ad', STRONG: '#6bd6c6',
        MUTED: '#a4b5b5', LINE: '#24383a', SOFT: '#142427',
        '#95a7a7': '#45625f', '#cbd6d6': '#263f3d',
    }
    for name in ('benchmark-overview', 'benchmark-overview-mobile',
                 'decision-families', 'decision-families-mobile', 'ridge'):
        svg = (OUT / f'{name}.svg').read_text()
        svg = re.sub(r'#[0-9a-fA-F]{6}\b', lambda m: palette.get(m[0].lower(), m[0]), svg)
        (OUT / f'{name}-dark.svg').write_text(svg)


if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    overview();overview(True);distribution();distribution(True);ridge();dark_variants()
    print('Built five light and five dark SVG assets from public aggregate counts and the brand fonts.')
