import numpy as np, json, math, sys
from PIL import Image
P=np.fromfile('tris.pos',np.float32).reshape(-1,3,3).astype(np.float64); M=np.fromfile('tris.mat',np.uint16).astype(int); UV=np.fromfile('tris.uv',np.float32).reshape(-1,3,2).astype(np.float64)
meta=json.load(open('tris.meta.json'))
a,b,c=P[:,0],P[:,1],P[:,2]
nrm=np.cross(b-a,c-a); area=0.5*np.linalg.norm(nrm,axis=1); nn=nrm/np.maximum(np.linalg.norm(nrm,axis=1,keepdims=True),1e-9)
ymin=P[:,:,1].min(1); ymax=P[:,:,1].max(1)
tall=(np.abs(nn[:,1])<0.2)&(area>2)&((ymax-ymin)>3.5)&(ymax>5)
hor=np.abs(nn[:,1])>0.5

# ---------- 1 m rasters over the whole (future) city rectangle ----------
X0,X1,Z0,Z1=-240,540,-620,360
W,H=X1-X0,Z1-Z0
ground=np.full((H,W),np.nan)                 # top height of horizontal surfaces (roads, roofs, extrusions); NaN = void
wallid=np.zeros((H,W),np.int32)             # which wall cluster crosses the cell
def cell(x,z): return int(math.floor(z-Z0)),int(math.floor(x-X0))
# rasterise horizontal triangles exactly (cell centres inside the triangle)
for k in np.where(hor)[0]:
    t=P[k]; xs=t[:,0]; zs=t[:,2]
    i0,i1=int(math.floor(xs.min()-X0)),int(math.ceil(xs.max()-X0)); j0,j1=int(math.floor(zs.min()-Z0)),int(math.ceil(zs.max()-Z0))
    if i1<=i0 and j1<=j0: i1=i0+1; j1=j0+1
    gx,gz=np.meshgrid(np.arange(i0,i1+1)+X0+0.5,np.arange(j0,j1+1)+Z0+0.5)
    d=(zs[1]-zs[2])*(xs[0]-xs[2])+(xs[2]-xs[1])*(zs[0]-zs[2])
    if abs(d)<1e-9: continue
    l1=((zs[1]-zs[2])*(gx-xs[2])+(xs[2]-xs[1])*(gz-zs[2]))/d; l2=((zs[2]-zs[0])*(gx-xs[2])+(xs[0]-xs[2])*(gz-zs[2]))/d; l3=1-l1-l2
    inside=(l1>=-0.02)&(l2>=-0.02)&(l3>=-0.02)
    if not inside.any(): continue
    h=l1*t[0,1]+l2*t[1,1]+l3*t[2,1]
    ii=(gx[inside]-X0-0.5).astype(int); jj=(gz[inside]-Z0-0.5).astype(int); hh=h[inside]
    ok=(ii>=0)&(ii<W)&(jj>=0)&(jj<H)
    cur=ground[jj[ok],ii[ok]]; ground[jj[ok],ii[ok]]=np.where(np.isnan(cur),hh[ok],np.maximum(cur,hh[ok]))
print('raster built; non-void cells inside model:',int(np.isfinite(ground).sum()))


# =====================  CITY LAYOUT: outer roads  =====================
CITY=dict(x0=-210,x1=500,z0=-576,z1=322)
BB=dict(x0=-1,x1=293,z0=-367,z1=113)                 # the original model's rectangle
RING=dict(xL=-16,xR=309,zT=-383,zB=129)              # ring road centre lines, ~15 m outside the model
RW=16.0
lines=[]                                              # each: ax ('h' runs along x at z=c, 'v' runs along z at x=c), c, a0, a1, w
def add_line(ax,c,a0,a1,w=RW): lines.append(dict(ax=ax,c=float(c),a0=float(a0),a1=float(a1),w=float(w)))
xs=[RING['xL']+k*(RING['xR']-RING['xL'])/4 for k in range(-3,8)]
zs=[RING['zT']+k*(RING['zB']-RING['zT'])/6 for k in range(-2,9)]
for k,x in zip(range(-3,8),xs):                       # vertical avenues: full height outside the ring, only in the north/south strips inside its width
    if k<0 or k>4:
        if CITY['x0']+8<x<CITY['x1']-8: add_line('v',x,CITY['z0'],CITY['z1'])
    else:
        add_line('v',x,CITY['z0'],RING['zT']); add_line('v',x,RING['zB'],CITY['z1'])
for k,z in zip(range(-2,9),zs):
    if k<0 or k>6:
        if CITY['z0']+8<z<CITY['z1']-8: add_line('h',z,CITY['x0'],CITY['x1'])
    else:
        add_line('h',z,CITY['x0'],RING['xL']); add_line('h',z,RING['xR'],CITY['x1'])
add_line('h',RING['zT'],RING['xL'],RING['xR']); add_line('h',RING['zB'],RING['xL'],RING['xR'])
add_line('v',RING['xL'],RING['zT'],RING['zB']); add_line('v',RING['xR'],RING['zT'],RING['zB'])
# connectors: where the model's own streets reach its edge, continue them to the ring road
def is_street(x,z):
    j,i=cell(x,z)
    if not(0<=i<W and 0<=j<H): return False
    h=ground[j,i]; return np.isfinite(h) and h<2.5
def runs(vals):
    out=[];start=None;gap=0
    for k,v in enumerate(vals):
        if v: 
            if start is None: start=k
            gap=0; last=k
        elif start is not None:
            gap+=1
            if gap>3: out.append((start,last)); start=None
    if start is not None: out.append((start,last))
    return out
conn=[]
DEPTH=30
for side in ('W','E'):
    zr=np.arange(BB['z0'],BB['z1'],1.0)
    xs_band=[BB['x0']+k for k in range(DEPTH)] if side=='W' else [BB['x1']-k for k in range(DEPTH)]
    ends=[]
    for z in zr:
        hit=[x for x in xs_band if is_street(x,z)]
        ends.append((min(hit) if side=='W' else max(hit)) if hit else None)
    for a,b in runs([e is not None for e in ends]):
        if b-a<5: continue
        zc=zr[a]+(b-a)/2; wd=float(np.clip(b-a+2,9,14)); es=[e for e in ends[a:b+1] if e is not None]
        xe=min(es) if side=='W' else max(es)
        add_line('h',zc,RING['xL'] if side=='W' else xe-4,xe+4 if side=='W' else RING['xR'],wd); conn.append((side,zc,wd))
for side in ('N','S'):
    xr=np.arange(BB['x0'],BB['x1'],1.0)
    zs_band=[BB['z0']+k for k in range(DEPTH)] if side=='N' else [BB['z1']-k for k in range(DEPTH)]
    ends=[]
    for x in xr:
        hit=[z for z in zs_band if is_street(x,z)]
        ends.append((min(hit) if side=='N' else max(hit)) if hit else None)
    for a,b in runs([e is not None for e in ends]):
        if b-a<5: continue
        xc=xr[a]+(b-a)/2; wd=float(np.clip(b-a+2,9,14)); es=[e for e in ends[a:b+1] if e is not None]
        ze=min(es) if side=='N' else max(es)
        add_line('v',xc,RING['zT'] if side=='N' else ze-4,ze+4 if side=='N' else RING['zB'],wd); conn.append((side,xc,wd))
print('road lines',len(lines),'connectors to the model streets',len(conn))
roadcells=0
for L in lines:
    hw=L['w']/2
    if L['ax']=='h': x0,x1,z0,z1=L['a0'],L['a1'],L['c']-hw,L['c']+hw
    else: x0,x1,z0,z1=L['c']-hw,L['c']+hw,L['a0'],L['a1']
    i0,i1=int(math.floor(x0-X0)),int(math.ceil(x1-X0)); j0,j1=int(math.floor(z0-Z0)),int(math.ceil(z1-Z0))
    sub=ground[j0:j1,i0:i1]; m=np.isnan(sub); sub[m]=0.0; roadcells+=int(m.sum())
print('road cells painted',roadcells)
# ---------- cluster tall walls by plane ----------
idx=np.where(tall)[0]
ang=np.arctan2(nn[idx,2],nn[idx,0]); ang=np.mod(ang,math.pi)            # normal direction up to sign
sgn=np.where(np.arctan2(nn[idx,2],nn[idx,0])==ang,1.0,-1.0)
dist=(nn[idx,0]*P[idx,0,0]+nn[idx,2]*P[idx,0,2])*sgn
keys={}
for q,k in enumerate(idx):
    key=(int(round(ang[q]/math.radians(2.5))),int(round(dist[q]/0.35)))
    keys.setdefault(key,[]).append(k)
clusters=[]
for key,ks in keys.items():
    th=key[0]*math.radians(2.5); n=np.array([math.cos(th),0,math.sin(th)]); t=np.array([-math.sin(th),0,math.cos(th)]); d0=np.mean([ (n@P[k,0])  for k in ks])
    pts=P[ks].reshape(-1,3); s=pts@t
    clusters.append(dict(ks=ks,n=n,t=t,d0=d0,smin=s.min(),smax=s.max(),theta=th))
print('wall triangles',len(idx),'plane clusters',len(clusters))
# connect clusters: split clusters that are far apart along the plane into separate walls (gap > 3 m)
walls=[]
for cl in clusters:
    ks=cl['ks']; t=cl['t']; segs=sorted([(P[k]@t).min() for k in ks]); 
    order=sorted(ks,key=lambda k:(P[k]@t).min()); cur=[order[0]]; hi=(P[order[0]]@t).max()
    for k in order[1:]:
        lo=(P[k]@t).min()
        if lo>hi+3.0: walls.append(dict(cl,ks=cur)); cur=[k]; hi=(P[k]@t).max()
        else: cur.append(k); hi=max(hi,(P[k]@t).max())
    walls.append(dict(cl,ks=cur))
print('separate walls',len(walls))

STEP=1.0
def profile(w):
    n,t=w['n'],w['t']; ks=w['ks']; allp=P[ks].reshape(-1,3); s_all=allp@t
    s0,s1=s_all.min(),s_all.max(); nb=max(1,int(math.ceil((s1-s0)/STEP)))
    lo=np.full(nb,np.inf); hi=np.full(nb,-np.inf)
    for k in ks:
        tri=P[k]; ss=tri@t; yy=tri[:,1]
        b0=max(0,int((ss.min()-s0)/STEP)); b1=min(nb-1,int((ss.max()-s0)/STEP))
        for bi in range(b0,b1+1):
            sc=s0+(bi+0.5)*STEP; ys=[]
            for e in ((0,1),(1,2),(2,0)):
                sa,sb=ss[e[0]],ss[e[1]]
                if (sa-sc)*(sb-sc)<=0 and abs(sb-sa)>1e-9: ys.append(yy[e[0]]+(yy[e[1]]-yy[e[0]])*(sc-sa)/(sb-sa))
            if len(ys)>=2: lo[bi]=min(lo[bi],min(ys)); hi[bi]=max(hi[bi],max(ys))
    return s0,nb,lo,hi
def side_has_street(x,z):
    j,i=cell(x,z)
    if not(0<=i<W and 0<=j<H): return False
    h=ground[j,i]; return np.isfinite(h) and h<3.0
extruded=[]; stats=dict(skipped_both=0,skipped_none=0,boxes=0)
mat_count={}
order=sorted(range(len(walls)),key=lambda i:-(walls[i]['smax']-walls[i]['smin']))
for wi in order:
    w=walls[wi]; n,t=w['n'],w['t']; s0,nb,lo,hi=profile(w); base=n*w['d0']
    # which side is the street? vote with several samples along the wall
    vote=0; samples=[b for b in range(nb) if np.isfinite(hi[b])][::max(1,nb//6)]
    for bi in samples:
        sc=s0+(bi+0.5)*STEP; p=base+t*sc
        front=side_has_street(*(p+n*6.0)[[0,2]]); back=side_has_street(*(p-n*6.0)[[0,2]])
        vote+= (1 if front and not back else -1 if back and not front else 0)
    if vote==0: stats['skipped_both']+=1; continue
    bk = -n if vote>0 else n         # extrude away from the street
    # wall material and texture scale from its biggest triangle
    ks=w['ks']; kbig=max(ks,key=lambda k:area[k]); mi=M[kbig]
    tri=P[kbig]; uv=UV[kbig]; ss=tri@t; yy=tri[:,1]
    A=np.array([[ss[0],yy[0],1],[ss[1],yy[1],1],[ss[2],yy[2],1]])
    try: su=np.linalg.solve(A,uv[:,0]); sv=np.linalg.solve(A,uv[:,1])
    except np.linalg.LinAlgError: continue
    depth=np.zeros(nb)
    for bi in range(nb):
        if not np.isfinite(hi[bi]) or hi[bi]<5: continue
        sc=s0+(bi+0.5)*STEP; p=base+t*sc; d=0.0
        for step in range(1,46):
            q=p+bk*step; j,i=cell(q[0],q[2])
            if not(0<=i<W and 0<=j<H): break
            if step>=2 and (np.isfinite(ground[j,i]) or (wallid[j,i] not in (0,wi+1))): break
            d=step
        depth[bi]=d if d>=3 else 0
    if depth.max()<3: stats['skipped_none']+=1; continue
    # merge neighbouring slices with the same height/depth into boxes
    bi=0
    marks=[]
    while bi<nb:
        if depth[bi]<3: bi+=1; continue
        bj=bi; top=hi[bi]; dep=depth[bi]
        while bj+1<nb and depth[bj+1]>=3 and abs(hi[bj+1]-top)<0.6 and abs(depth[bj+1]-dep)<2.0:
            bj+=1; top=min(top,hi[bj]); dep=min(dep,depth[bj])
        extruded.append(dict(base=(base+t*s0).tolist(),t=t.tolist(),bk=bk.tolist(),s0=(bi*STEP),s1=((bj+1)*STEP),depth=float(dep),y0=float(max(-0.3,lo[bi:bj+1].min()) if np.isfinite(lo[bi:bj+1]).any() else 0.0) if False else -0.3,y1=float(top),mat=int(mi),su=su.tolist(),sv=sv.tolist(),s_origin=float(s0),wall=wi))
        marks.append((bi,bj,dep,top)); bi=bj+1
    # claim the cells so later walls stop at this building
    for (bi,bj,dep,top) in marks:
        for q in range(bi,bj+1):
            sc=s0+(q+0.5)*STEP; p=base+t*sc
            for step in range(0,int(dep)+1):
                pp=p+bk*step; j,i=cell(pp[0],pp[2])
                if 0<=i<W and 0<=j<H and np.isnan(ground[j,i]): ground[j,i]=top
    # mark this wall's own cells so others can see it
    for q in range(nb):
        sc=s0+(q+0.5)*STEP; pp=base+t*sc; j,i=cell(pp[0],pp[2])
        if 0<=i<W and 0<=j<H and wallid[j,i]==0: wallid[j,i]=wi+1
    stats['boxes']=len(extruded); mat_count[mi]=mat_count.get(mi,0)+1
print('extrusion:',stats,'walls extruded using',len(mat_count),'materials')
json.dump(extruded,open('extruded.json','w'))

# =====================  PART B: geometry for roads, ground, infill buildings, parks  =====================
import random as _random
R=np.random.default_rng(2026); RP=_random.Random(2026)
mats={}; quads=[]
def mat(name,tex=None,emissive=None,color=(1,1,1),rough=0.9,metal=0.0):
    if name not in mats: mats[name]=dict(name=name,tex=tex,emissive=emissive,color=list(color),rough=rough,metal=metal)
    return name
def q(m,p,uv,n): quads.append(dict(mat=m,p=[[round(float(v),3) for v in pt] for pt in p],uv=[[round(float(v),4) for v in t] for t in uv],n=[float(v) for v in n]))
def r1(v): return round(float(v),3)

M_STRIP=mat('road_strip','tex/road_strip.png',rough=0.95); M_ASPH=mat('asphalt','tex/asphalt.png',rough=0.95)
M_GROUND=mat('ground','tex/ground.png',rough=1.0); M_GRASS=mat('grass',None,color=(0.20,0.34,0.16),rough=1.0)
M_TREE=mat('tree',None,color=(0.12,0.26,0.12),rough=1.0); M_DETAIL=mat('rooftop_detail',None,color=(0.46,0.47,0.49),rough=0.7,metal=0.3)
M_ROOF=mat('roof','tex/roof.png',rough=1.0); M_CONC=mat('concrete','tex/concrete.png',rough=0.95)

# ---- ground under everything (below the model's own roads so nothing z-fights) ----
q(M_GROUND,[[CITY['x0'],-0.35,CITY['z0']],[CITY['x1'],-0.35,CITY['z0']],[CITY['x1'],-0.35,CITY['z1']],[CITY['x0'],-0.35,CITY['z1']]],
  [[CITY['x0']/16,CITY['z0']/16],[CITY['x1']/16,CITY['z0']/16],[CITY['x1']/16,CITY['z1']/16],[CITY['x0']/16,CITY['z1']/16]],[0,1,0])

# ---- road strips and junction squares ----
for L in lines:
    hw=L['w']/2; u0=(16-L['w'])/32; Y=0.05
    if L['ax']=='h':
        p=[[L['a0'],Y,L['c']-hw],[L['a1'],Y,L['c']-hw],[L['a1'],Y,L['c']+hw],[L['a0'],Y,L['c']+hw]]
        uv=[[u0,L['a0']/16],[u0,L['a1']/16],[1-u0,L['a1']/16],[1-u0,L['a0']/16]]
    else:
        p=[[L['c']-hw,Y,L['a0']],[L['c']-hw,Y,L['a1']],[L['c']+hw,Y,L['a1']],[L['c']+hw,Y,L['a0']]]
        uv=[[u0,L['a0']/16],[u0,L['a1']/16],[1-u0,L['a1']/16],[1-u0,L['a0']/16]]
    q(M_STRIP,p,uv,[0,1,0])
hl=[L for L in lines if L['ax']=='h']; vl=[L for L in lines if L['ax']=='v']; seen=set(); nj=0
for h in hl:
    for v in vl:
        if v['a0']-1<=h['c']<=v['a1']+1 and h['a0']-1<=v['c']<=h['a1']+1:
            key=(round(v['c']),round(h['c']))
            if key in seen: continue
            seen.add(key); s=max(h['w'],v['w'])/2; cx,cz=v['c'],h['c']; Y=0.10; nj+=1
            q(M_ASPH,[[cx-s,Y,cz-s],[cx+s,Y,cz-s],[cx+s,Y,cz+s],[cx-s,Y,cz+s]],[[(cx-s)/8,(cz-s)/8],[(cx+s)/8,(cz-s)/8],[(cx+s)/8,(cz+s)/8],[(cx-s)/8,(cz+s)/8]],[0,1,0])
print('junctions',nj)

# ---- find the lots ----
occ=np.isfinite(ground)
blocked=occ.copy()
for _ in range(2):                                   # 2 m buffer around everything that exists
    b=blocked.copy(); b[1:]|=blocked[:-1]; b[:-1]|=blocked[1:]; b[:,1:]|=blocked[:,:-1]; b[:,:-1]|=blocked[:,1:]; blocked=b
inX0,inX1,inZ0,inZ1=int(CITY['x0']-X0),int(CITY['x1']-X0),int(CITY['z0']-Z0),int(CITY['z1']-Z0)
mask=np.ones_like(blocked); mask[inZ0:inZ1,inX0:inX1]=False; blocked|=mask               # outside the city rectangle is not buildable
cs=2; nx=(inX1-inX0)//cs; nz=(inZ1-inZ0)//cs
free=np.zeros((nz,nx),bool)
for r in range(nz):
    row=blocked[inZ0+r*cs:inZ0+r*cs+cs]
    free[r]=~(row[:, inX0:inX0+nx*cs].reshape(cs,nx,cs).any(axis=(0,2)))
used=~free; lots=[]
for r in range(nz):
    for c in range(nx):
        if used[r,c]: continue
        big=R.random()<0.14
        tw=int(R.integers(9,20) if big else R.integers(5,13)); th=int(R.integers(9,20) if big else R.integers(5,13))
        w=0
        while w<tw and c+w<nx and not used[r,c+w]: w+=1
        if w<4: used[r,c]=True; continue
        h=1
        while h<th and r+h<nz and not used[r+h,c:c+w].any(): h+=1
        if h<4: used[r,c]=True; continue
        lots.append((r,c,w,h)); used[r:r+h+2,c:c+w+2]=True          # +2 cells = 4 m alley on the far sides
print('lots',len(lots))

# ---- buildings ----
STYLES=['brick','concrete','glass','industrial','white','stone','dark','tower']
TINTS=[(1,1,1),(1.18,1.08,0.95),(0.84,0.9,1.02),(1.06,0.96,0.88)]
def wall_mat(style,tint):
    return mat(f'bld_{style}_{tint}',f'tex/bld_{style}.png',f'tex/bld_{style}_e.png',TINTS[tint],0.85)
CX,CZ=140.0,-130.0
def pick_style(h):
    if h>70: return RP.choice(['glass','glass','tower','concrete','white'])
    if h>35: return RP.choice(['concrete','white','stone','dark','glass','tower','brick'])
    return RP.choice(['brick','brick','industrial','stone','dark','concrete','white'])
def faces(x0,z0,x1,z1,y0,y1,wm,roofm,u0,v0,roof=True):
    uz=lambda z:(z-z0)/16+u0; ux=lambda x:(x-x0)/16+u0; v=lambda y:y/16+v0
    q(wm,[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],[[ux(x0),v(y0)],[ux(x1),v(y0)],[ux(x1),v(y1)],[ux(x0),v(y1)]],[0,0,1])
    q(wm,[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]],[[ux(x1),v(y0)],[ux(x0),v(y0)],[ux(x0),v(y1)],[ux(x1),v(y1)]],[0,0,-1])
    q(wm,[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]],[[uz(z1),v(y0)],[uz(z0),v(y0)],[uz(z0),v(y1)],[uz(z1),v(y1)]],[1,0,0])
    q(wm,[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]],[[uz(z0),v(y0)],[uz(z1),v(y0)],[uz(z1),v(y1)],[uz(z0),v(y1)]],[-1,0,0])
    if roof: q(roofm,[[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],[[x0/10,z0/10],[x1/10,z0/10],[x1/10,z1/10],[x0/10,z1/10]],[0,1,0])
def solid(x0,z0,x1,z1,y0,y1,m):                                        # plain colour box (rooftop details)
    faces(x0,z0,x1,z1,y0,y1,m,m,0,0)

def slab(x0,z0,x1,z1,y0,y1,m):
    faces(x0,z0,x1,z1,y0,y1,m,m,0,0); q(m,[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]],[[x0/6,z0/6],[x1/6,z0/6],[x1/6,z1/6],[x0/6,z1/6]],[0,-1,0])
def garage(x0,z0,x1,z1):
    n=RP.randint(5,8); fh=3.4
    for k in range(n+1): slab(x0,z0,x1,z1,k*fh-0.45,k*fh,M_CONC)                       # floor plates
    for k in range(n):
        y=k*fh
        for (a,b,c,d) in ((x0,z0,x1,z0+0.35),(x0,z1-0.35,x1,z1),(x0,z0,x0+0.35,z1),(x1-0.35,z0,x1,z1)):
            solid(a,b,c,d,y,y+0.95,M_CONC)                                              # low parapet, the sides stay open
    gx=x0+4
    while gx<x1-2:
        gz=z0+4
        while gz<z1-2: solid(gx,gz,gx+0.7,gz+0.7,0,n*fh,M_CONC); gz+=8
        gx+=8
    solid(x0,z0,x0+6,z0+6,0,n*fh+3,M_CONC)                                              # stair core
    return n*fh+3
def arch(x0,z0,x1,z1,hgt,wm,u0):
    fw,fd=x1-x0,z1-z0
    if fw>=fd:
        gap=12; hw=(fw-gap)/2; faces(x0,z0,x0+hw,z1,-0.3,hgt,wm,M_ROOF,u0,0); faces(x1-hw,z0,x1,z1,-0.3,hgt,wm,M_ROOF,u0,0)
        by=hgt*0.5; faces(x0+hw,z0,x1-hw,z1,by,by+9,wm,M_ROOF,u0,0.25); slab(x0+hw,z0,x1-hw,z1,by-0.5,by,M_CONC)
    else:
        gap=12; hd=(fd-gap)/2; faces(x0,z0,x1,z0+hd,-0.3,hgt,wm,M_ROOF,u0,0); faces(x0,z1-hd,x1,z1,-0.3,hgt,wm,M_ROOF,u0,0)
        by=hgt*0.5; faces(x0,z0+hd,x1,z1-hd,by,by+9,wm,M_ROOF,u0,0.25); slab(x0,z0+hd,x1,z1-hd,by-0.5,by,M_CONC)
cand=[i for i,(r,c,w,h) in enumerate(lots) if w*h*cs*cs>=520 and w*cs>=22 and h*cs>=22]
RP.shuffle(cand); near=[i for i in cand if math.hypot(CITY['x0']+(lots[i][1]+lots[i][2]/2)*cs-CX,CITY['z0']+(lots[i][0]+lots[i][3]/2)*cs-CZ)<330]
garage_ids=set(near[:6]); arch_ids=set([i for i in near[6:14] if i not in garage_ids][:3])
lot_info={}
nb=0; npark=0; tall=0; ngar=0; narch=0
for li,(r,c,w,h) in enumerate(lots):
    x0=CITY['x0']+c*cs; z0=CITY['z0']+r*cs; x1=x0+w*cs; z1=z0+h*cs; fw=x1-x0; fd=z1-z0
    cx,cz=(x0+x1)/2,(z0+z1)/2
    if (fw<=22 and fd<=22) and RP.random()<0.10:                       # small pocket park with trees
        npark+=1; q(M_GRASS,[[x0,-0.30,z0],[x1,-0.30,z0],[x1,-0.30,z1],[x0,-0.30,z1]],[[0,0],[1,0],[1,1],[0,1]],[0,1,0])
        for _ in range(max(3,int(fw*fd/55))):
            tx=RP.uniform(x0+2,x1-2); tz=RP.uniform(z0+2,z1-2); s=RP.uniform(1.6,2.6); th=RP.uniform(4.5,8)
            apex=[tx,th,tz]; B=[[tx-s,0,tz-s],[tx+s,0,tz-s],[tx+s,0,tz+s],[tx-s,0,tz+s]]
            for k in range(4):
                a1_,b1_=B[k],B[(k+1)%4]; nrm=[(a1_[0]+b1_[0])/2-tx,0.6,(a1_[2]+b1_[2])/2-tz]
                q(M_TREE,[a1_,b1_,apex,apex],[[0,0],[1,0],[0.5,1],[0.5,1]],nrm)
        continue
    if li in garage_ids:
        gh=garage(x0,z0,x1,z1); lot_info[li]=dict(x0=x0,z0=z0,x1=x1,z1=z1,hgt=gh,kind='garage'); ngar+=1; continue
    d=math.hypot(cx-CX,cz-CZ)/460.0
    scale=13+58*math.exp(-d*d*2.6)
    hgt=float(np.clip(scale*math.exp(R.normal(0,0.42)),9,118))
    if d<0.55 and RP.random()<0.04: hgt=RP.uniform(88,126)
    if hgt>60: tall+=1
    style=pick_style(hgt); tint=RP.randrange(4); wm=wall_mat(style,tint); u0=RP.random(); v0=RP.randrange(4)/4.0
    if li in arch_ids:
        hgt=max(hgt,58); arch(x0,z0,x1,z1,hgt,wall_mat('tower',RP.randrange(4)),u0); lot_info[li]=dict(x0=x0,z0=z0,x1=x1,z1=z1,hgt=hgt,kind='arch'); narch+=1; continue
    lot_info[li]=dict(x0=x0,z0=z0,x1=x1,z1=z1,hgt=hgt,kind='bld')
    if fw*fd>=420 and hgt>38:                                           # podium + tower
        ph=RP.uniform(10,20); faces(x0,z0,x1,z1,-0.3,ph,wm,M_ROOF,u0,v0)
        ins=RP.uniform(3,6); tx0,tz0,tx1,tz1=x0+ins,z0+ins,x1-ins,z1-ins
        style2=pick_style(hgt+20); wm2=wall_mat(style2,RP.randrange(4)); faces(tx0,tz0,tx1,tz1,ph,hgt,wm2,M_ROOF,RP.random(),0)
        rx0,rz0,rx1,rz1,ry=tx0,tz0,tx1,tz1,hgt
    else:
        faces(x0,z0,x1,z1,-0.3,hgt,wm,M_ROOF,u0,v0); rx0,rz0,rx1,rz1,ry=x0,z0,x1,z1,hgt
    nb+=1
    # roof clutter
    if (rx1-rx0)*(rz1-rz0)>150 and RP.random()<0.6:
        for _ in range(RP.randint(2,5)):
            sx,sz=RP.uniform(1.6,3.2),RP.uniform(1.6,3.2); px=RP.uniform(rx0+1,rx1-1-sx); pz=RP.uniform(rz0+1,rz1-1-sz)
            solid(px,pz,px+sx,pz+sz,ry,ry+RP.uniform(1.0,2.4),M_DETAIL)
    if hgt>55 and RP.random()<0.5:
        mx,mz=(rx0+rx1)/2,(rz0+rz1)/2; solid(mx-0.3,mz-0.3,mx+0.3,mz+0.3,ry,ry+RP.uniform(8,16),M_DETAIL)

# ---- sky bridges across 4 m alleys between tall neighbours ----
nbr=0; info=[v for v in lot_info.values() if v['kind']=='bld' and v['hgt']>46]
for a in info:
    for bb in info:
        if bb is a or nbr>=26: continue
        gap=bb['x0']-a['x1']
        if 3.5<=gap<=4.5:
            lo=max(a['z0'],bb['z0'])+2; hi=min(a['z1'],bb['z1'])-2
            if hi-lo>=6 and RP.random()<0.30:
                z0b=RP.uniform(lo,hi-5); y=RP.uniform(20,min(a['hgt'],bb['hgt'])-8)
                wm=wall_mat('glass',RP.randrange(4)); faces(a['x1'],z0b,bb['x0'],z0b+5,y,y+3.4,wm,M_ROOF,0,0); slab(a['x1'],z0b,bb['x0'],z0b+5,y-0.4,y,M_CONC); nbr+=1
# ---- elevated highway along one long avenue ----
HX=RING['xR']+(RING['xR']-RING['xL'])/4; HY=11.0                                     # x of the avenue, deck height
slab(HX-6.5,CITY['z0']+10,HX+6.5,CITY['z1']-10,HY,HY+1.4,M_CONC)
for sx in (-6.5,6.0):
    solid(HX+sx,CITY['z0']+10,HX+sx+0.5,CITY['z1']-10,HY+1.4,HY+2.3,M_CONC)       # side barriers
cols=0; zc=CITY['z0']+24
while zc<CITY['z1']-24:
    near_junction=any(abs(zc-L['c'])<11 for L in hl if L['a0']-1<=HX<=L['a1']+1)
    if not near_junction: solid(HX-0.9,zc-0.9,HX+0.9,zc+0.9,0,HY,M_CONC); cols+=1
    zc+=22
special=[dict(kind=v['kind'],x=round((v['x0']+v['x1'])/2),z=round((v['z0']+v['z1'])/2),h=round(v['hgt'])) for v in lot_info.values() if v['kind'] in ('garage','arch')]
json.dump(dict(special=special,highway_x=HX,highway_y=HY),open('special.json','w'))
print('special structures:',special,'highway x',HX)
print('garages',ngar,'arch towers',narch,'sky bridges',nbr,'highway columns',cols)
print('buildings',nb,'parks',npark,'tall (>60 m)',tall,'quads',len(quads),'materials',len(mats))
json.dump(dict(materials=list(mats.values()),quads=quads),open('fill.json','w'))
# top-down map of the final layout
img=np.zeros((H,W,3),np.uint8); img[:]=(24,40,70)
img[np.isfinite(ground)]=(78,78,78)
for L in lines:
    hw=L['w']/2
    if L['ax']=='h': x0,x1,z0,z1=L['a0'],L['a1'],L['c']-hw,L['c']+hw
    else: x0,x1,z0,z1=L['c']-hw,L['c']+hw,L['a0'],L['a1']
    img[int(z0-Z0):int(z1-Z0),int(x0-X0):int(x1-X0)]=(110,110,110)
for (r,c,w,h) in lots:
    x0=CITY['x0']+c*cs; z0=CITY['z0']+r*cs
    img[int(z0-Z0):int(z0-Z0+h*cs),int(x0-X0):int(x0-X0+w*cs)]=(200,150,60)
for e in extruded:
    base=np.array(e['base']); t=np.array(e['t']); bk=np.array(e['bk'])
    for s_ in np.arange(e['s0'],e['s1'],1.0):
        for d_ in np.arange(0,e['depth'],1.0):
            p=base+t*(s_+0.5)+bk*d_; j,i=cell(p[0],p[2])
            if 0<=i<W and 0<=j<H: img[j,i]=(60,170,90)
Image.fromarray(img).save('city_layout.png')
