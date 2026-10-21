# Builds details.json (synonyms, meanings, example sentence per word) from Princeton WordNet + Tatoeba. Run from repo root; needs nltk and /tmp/sentences.csv (Tatoeba export).
import json,re,csv,sys,collections
from nltk.corpus import stopwords
STOP=set(stopwords.words('english'))|{'am','shall','may','might','must','can','will','would','could','should','upon','whom','whose','thus','therefore'}
from nltk.corpus import wordnet as wn
csv.field_size_limit(10**9)
vocab=json.load(open('vocab.json'))
words=[v['w'].lower() for v in vocab]
wset=set(words)
# candidate lemmas per word (word itself + morphy forms)
def forms(w):
    s={w}
    for p in 'nvar':
        m=wn.morphy(w,p)
        if m:s.add(m)
    return s
# Tatoeba
tok=re.compile(r"[a-z'-]+")
best=collections.defaultdict(list)
BAD=re.compile(r'\b(sex|sexual|fuck\w*|shit|rape\w*|kill\w*|suicide|murder\w*|porn\w*|bitch|dick|penis|naked|nazi|terroris\w*|bomb\w*|drunk|whore|slut|damn|hell|ass|cock|tits|boobs|hitler|jerk|idiot|stupid)\b',re.I)
good=re.compile(r"^[A-Z][^\"“”()\[\]0-9@/]*[.?!]$")
for row in csv.reader(open('/tmp/sentences.csv',encoding='utf8'),delimiter='\t',quoting=csv.QUOTE_NONE):
    if len(row)<3 or row[1]!='eng':continue
    s=row[2]
    n=len(s.split())
    if n<6 or n>13 or not good.match(s) or BAD.search(s):continue
    toks=set(tok.findall(s.lower()))
    for t in toks:
        if t in wset and len(best[t])<40: best[t].append(s)
        
# map inflected tokens to lemma words too
out={};stats=collections.Counter()
for v in vocab:
    w=v['w'].lower()
    d={}
    syn=[];defs=[];ex=None
    KEY=forms(w)-{w} or {w}
    sss=[] if w in STOP else wn.synsets(w)
    def freq(ss):
        return sum(l.count() for l in ss.lemmas() if l.name().lower().replace('_',' ') in KEY)
    sss=sorted(sss,key=lambda x:-freq(x))  # stable: WordNet order breaks ties
    if sss and freq(sss[0])>0: sss=[x for x in sss if freq(x)>0][:3] or sss[:3]
    else: sss=sss[:2]
    sss=[x for x in sss if not re.search(r'offensive|slur|derogatory|vulgar|obscene|disparag|ethnic|sexual|dated|\bvery informal',x.definition(),re.I)]
    for ss in sss:
        d=re.sub(r'(\s*;\s*)+',' ; ',ss.definition()).strip(' ;')
        d=re.sub(r'\s*;\s*-\s*\w+$','',d).strip(' ;')
        d=d.split(' ; ')[0] if len(d)>140 else d
        d=re.sub(r'\s*;\s*["(].*$','',d).strip(' ;"')
        d=' ; '.join(d.split(' ; ')[:2])
        tagd=ss.pos().replace('s','a')+'|'+d
        if tagd not in defs and d: defs.append(tagd)
        for l in ss.lemmas():
            n=l.name().replace('_',' ')
            if n.lower()==w or n.lower() in [x[0].lower() for x in syn]: continue
            if not n.islower() or re.search(r"[^a-z '-]",n): continue
            syn.append((n,l.count()))
        if not ex and ss.examples(): ex=ss.examples()[0]
    pos=[x for x in syn if x[1]>0]
    syn=pos if len(pos)>=2 else syn[:2]
    syn=[x[0] for x in syn]
    defs=defs[:3]; syn=syn[:4]
    cands=best.get(w,[])
    if cands:
        cands=sorted(cands,key=lambda s:abs(len(s.split())-9))
        sent=cands[0]
    else: sent=None
    if ex and (not sent): sent=ex
    if defs: stats['defs']+=1
    if syn: stats['syn']+=1
    if sent: stats['sent']+=1
    if sent and cands: stats['tatoeba']+=1
    r={}
    if syn:r['s']=syn
    if defs:r['d']=defs
    if sent:r['e']=sent
    if r: out[v['r']]=r
print(stats,len(out))
json.dump(out,open('details.json','w'),ensure_ascii=False,separators=(',',':'))
