import numpy as np, random
from PIL import Image, ImageDraw, ImageFilter
S=512; PPM=32     # 512 px = 16 m  ->  32 px per metre; floors are 4 m = 128 px
rng=np.random.default_rng(7); random.seed(7)

def noise(img,amount=10,seed=0):
    a=np.array(img).astype(np.int16); r=np.random.default_rng(seed)
    a[:,:,:3]+=r.normal(0,amount,a.shape[:2])[:,:,None].astype(np.int16)
    return Image.fromarray(np.clip(a,0,255).astype(np.uint8),img.mode)
def grime(img,strength=0.35):
    a=np.array(img).astype(np.float32); y=np.linspace(0,1,a.shape[0])[:,None,None]
    a[:,:,:3]*=1-strength*(y**2)*0.6             # darker toward the bottom of the tile
    return Image.fromarray(np.clip(a,0,255).astype(np.uint8),img.mode)
def lit(prob=0.4):
    c=random.random()
    if random.random()>prob: return None
    return (255,214,140) if c<0.6 else (255,243,200) if c<0.85 else (150,215,255)

def facade(style,seed):
    random.seed(seed); base=Image.new('RGB',(S,S)); d=ImageDraw.Draw(base)
    em=Image.new('RGB',(S,S),(0,0,0)); e=ImageDraw.Draw(em)
    P=dict(
      brick=dict(wall=(150,76,58),glass=(34,44,56),frame=(205,200,188),cols=4,ww=70,wh=70),
      concrete=dict(wall=(138,140,142),glass=(30,42,54),frame=(88,92,96),cols=2,ww=0,wh=56),
      glass=dict(wall=(78,112,130),glass=(88,138,160),frame=(40,52,60),cols=8,ww=0,wh=0),
      industrial=dict(wall=(112,116,118),glass=(40,48,56),frame=(70,72,74),cols=4,ww=54,wh=40),
      white=dict(wall=(226,223,214),glass=(48,64,84),frame=(170,170,166),cols=4,ww=78,wh=82),
      stone=dict(wall=(196,174,134),glass=(40,36,34),frame=(236,226,204),cols=4,ww=60,wh=84),
      dark=dict(wall=(104,98,94),glass=(26,30,36),frame=(70,66,64),cols=4,ww=64,wh=64),
      tower=dict(wall=(128,134,146),glass=(34,48,64),frame=(86,92,102),cols=8,ww=34,wh=92),
    )[style]
    d.rectangle([0,0,S,S],fill=P['wall'])
    if style=='brick':
        for y in range(0,S,12):
            for x in range(-(y//12%2)*20,S,40):
                t=random.randint(-14,14); col=tuple(max(0,min(255,c+t)) for c in P['wall'])
                d.rectangle([x+1,y+1,x+38,y+10],fill=col)
    if style=='industrial':
        for x in range(0,S,10): d.line([x,0,x,S],fill=(100,104,106),width=2)
    if style=='stone':
        for y in range(0,S,64): d.line([0,y,S,y],fill=(170,150,114),width=2)
    fw,fh=S//4,S//4
    for fl in range(4):
        y0=fl*fh
        # floor line / cornice
        d.rectangle([0,y0,S,y0+6],fill=tuple(max(0,c-25) for c in P['wall']))
        if style=='glass':
            cw=S//P['cols']
            for c in range(P['cols']):
                x0=c*cw; col=tuple(max(0,min(255,v+random.randint(-10,12))) for v in P['glass'])
                d.rectangle([x0+3,y0+12,x0+cw-3,y0+fh-34],fill=col)
                d.rectangle([x0+3,y0+fh-34,x0+cw-3,y0+fh-4],fill=P['wall'])       # spandrel
                if random.random()<0.32: e.rectangle([x0+5,y0+14,x0+cw-5,y0+fh-36],fill=lit(1) or (255,220,150))
        elif style=='concrete':
            for c in range(P['cols']):
                x0=c*(S//2); d.rectangle([x0+10,y0+34,x0+S//2-10,y0+34+P['wh']],fill=P['glass'])
                for m in range(x0+10,x0+S//2-10,64): d.line([m,y0+34,m,y0+34+P['wh']],fill=P['frame'],width=4)
                for k in range(4):
                    if random.random()<0.4:
                        xx=x0+10+k*((S//2-20)//4); e.rectangle([xx+3,y0+37,xx+((S//2-20)//4)-3,y0+31+P['wh']],fill=lit(1) or (255,220,150))
        else:
            cw=S//P['cols']
            for c in range(P['cols']):
                cx=c*cw+cw//2; wx0=cx-P['ww']//2; wy0=y0+(fh-P['wh'])//2+6
                if style=='tower' and c%2: continue
                d.rectangle([wx0-4,wy0-4,wx0+P['ww']+4,wy0+P['wh']+4],fill=P['frame'])
                d.rectangle([wx0,wy0,wx0+P['ww'],wy0+P['wh']],fill=P['glass'])
                if style in ('brick','white','dark','stone'): d.line([cx,wy0,cx,wy0+P['wh']],fill=P['frame'],width=3)
                if style=='stone': d.rectangle([wx0-8,wy0+P['wh']+4,wx0+P['ww']+8,wy0+P['wh']+10],fill=P['frame'])
                col=lit(0.42)
                if col: e.rectangle([wx0+2,wy0+2,wx0+P['ww']-2,wy0+P['wh']-2],fill=col)
    base=noise(base,6,seed); base=grime(base)
    return base,em

def tile_noise(color,amount,seed,size=S):
    r=np.random.default_rng(seed); a=np.zeros((size,size,3),np.float32)+np.array(color,np.float32)
    n=r.normal(0,amount,(size,size))[:,:,None]; a+=n
    big=np.array(Image.fromarray(r.normal(0,1,(16,16)).astype(np.float32)).resize((size,size),Image.BICUBIC))[:,:,None]*amount*1.6
    a+=big; return Image.fromarray(np.clip(a,0,255).astype(np.uint8))

def asphalt(seed=3):
    im=tile_noise((62,64,67),9,seed); d=ImageDraw.Draw(im)
    r=random.Random(seed)
    for _ in range(26):                                     # cracks
        x,y=r.randrange(S),r.randrange(S); pts=[(x,y)]
        for k in range(r.randint(4,9)): x+=r.randint(-30,30); y+=r.randint(-30,30); pts.append((x,y))
        d.line(pts,fill=(34,35,38),width=r.choice([1,2]))
    for _ in range(10):
        x,y=r.randrange(S),r.randrange(S); rad=r.randint(10,36); d.ellipse([x-rad,y-rad,x+rad,y+rad],fill=(57,59,62))
    return im.filter(ImageFilter.GaussianBlur(0.6))
def sidewalk():
    im=tile_noise((150,148,142),7,11); d=ImageDraw.Draw(im)
    for k in range(0,S,64): d.line([k,0,k,S],fill=(118,116,112),width=2); d.line([0,k,S,k],fill=(118,116,112),width=2)
    return im
def road_strip():
    """cross-section of a 16 m street: sidewalk 3 m | asphalt 10 m | sidewalk 3 m; dashes repeat every 8 m along v"""
    im=asphalt(5); d=ImageDraw.Draw(im); sw=sidewalk()
    im.paste(sw.crop((0,0,96,S)),(0,0)); im.paste(sw.crop((0,0,96,S)),(S-96,0))
    d.rectangle([96,0,100,S],fill=(176,174,168)); d.rectangle([S-100,0,S-96,S],fill=(176,174,168))   # kerbs
    d.rectangle([118,0,122,S],fill=(228,228,222)); d.rectangle([S-122,0,S-118,S],fill=(228,228,222)) # edge lines
    d.rectangle([248,0,252,S],fill=(226,186,40)); d.rectangle([260,0,264,S],fill=(226,186,40))        # double yellow
    for y in range(0,S,128):                                                                           # dashed lane lines
        d.rectangle([166,y,170,y+64],fill=(228,228,222)); d.rectangle([S-170,y,S-166,y+64],fill=(228,228,222))
    return im
def roof():
    im=tile_noise((84,82,80),4,21); d=ImageDraw.Draw(im); r=random.Random(5)
    for _ in range(40):
        x,y=r.randrange(S),r.randrange(S); d.ellipse([x-4,y-4,x+4,y+4],fill=(96,94,92))
    for k in range(0,S,128): d.line([k,0,k,S],fill=(56,55,54),width=2)
    return im
def ground():
    return tile_noise((96,92,84),4,31)

STYLES=['brick','concrete','glass','industrial','white','stone','dark','tower']
for i,st in enumerate(STYLES):
    b,e=facade(st,100+i); b.save(f'tex/bld_{st}.png'); e.save(f'tex/bld_{st}_e.png')
def concrete():
    im=tile_noise((158,158,154),7,41); d=ImageDraw.Draw(im); r=random.Random(9)
    for k in range(0,S,128): d.line([0,k,S,k],fill=(120,120,116),width=3)
    for _ in range(60):
        x=r.randrange(S); d.line([x,0,x+r.randint(-6,6),S],fill=(140,140,136),width=1)
    return im.filter(ImageFilter.GaussianBlur(0.5))
concrete().save('tex/concrete.png')
asphalt().save('tex/asphalt.png'); road_strip().save('tex/road_strip.png'); sidewalk().save('tex/sidewalk.png'); roof().save('tex/roof.png'); ground().save('tex/ground.png')
# contact sheet
sheet=Image.new('RGB',(256*5,256*3),(0,0,0))
names=[f'bld_{s}' for s in STYLES]+['asphalt','road_strip','sidewalk','roof','ground']
for k,n in enumerate(names): sheet.paste(Image.open(f'tex/{n}.png').resize((256,256)),((k%5)*256,(k//5)*256))
for k,s in enumerate(STYLES[:5]): sheet.paste(Image.open(f'tex/bld_{s}_e.png').resize((256,256)),(k*256,512))
sheet.save('tex_sheet.png'); print('ok')
