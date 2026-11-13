import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync,createWriteStream} from 'node:fs'
import {Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
// Initial release verification: metadata uses gh; every asset download is public and unauthenticated.
const repo='yuchen0x1/Novel-Writer-master'
const api=path=>JSON.parse(execFileSync('gh',['api',`repos/${repo}/${path}`],{encoding:'utf8'}))
const release=api('releases/tags/v0.0.1')
const latest=api('releases/latest')
if(release.draft||release.prerelease||latest.id!==release.id)throw Error('Release is not the public stable latest version')
const profile=JSON.parse(readFileSync('.release/release-profile.json','utf8'))
const expected=profile.releaseAssets.map(x=>x.name.replaceAll('{version}','0.0.1'))
const sumsAsset=release.assets.find(x=>x.name==='SHA256SUMS.txt')
if(!sumsAsset)throw Error('Missing checksum file')
const sumsResponse=await fetch(sumsAsset.browser_download_url)
if(!sumsResponse.ok)throw Error(`Checksum HTTP ${sumsResponse.status}`)
const sums=await sumsResponse.text()
const sumsBytes=Buffer.from(sums)
const sumsHash=createHash('sha256').update(sumsBytes).digest('hex')
if(sumsAsset.size!==sumsBytes.length || sumsAsset.digest!==`sha256:${sumsHash}`)throw Error('Checksum-list bytes differ from GitHub metadata')
const output='.runtime/rebrand-v0.0.1/published'
mkdirSync(output,{recursive:true})
writeFileSync(`${output}/SHA256SUMS.txt`,sums)
const results=await Promise.all(expected.map(async name=>{
  const asset=release.assets.find(x=>x.name===name)
  if(!asset||asset.size<=0)throw Error(`Missing asset ${name}`)
  const entry=sums.split(/\r?\n/).find(x=>x.endsWith(`  ${name}`))
  if(!entry)throw Error(`Missing checksum ${name}`)
  const expectedHash=entry.slice(0,64)
  if(asset.digest!==`sha256:${expectedHash}`)throw Error(`GitHub checksum differs for ${name}`)
  const response=await fetch(asset.browser_download_url)
  if(!response.ok)throw Error(`${name}: HTTP ${response.status}`)
  const hash=createHash('sha256');let size=0
  const meter=new Transform({transform(chunk,encoding,done){size+=chunk.length;hash.update(chunk);done(null,chunk)}})
  await pipeline(response.body,meter,createWriteStream(`${output}/${name}`))
  const actual=hash.digest('hex')
  if(actual!==expectedHash||size!==asset.size)throw Error(`Downloaded bytes differ for ${name}`)
  console.log(`PASS ${name} (${size} bytes)`)
  return{name,size,sha256:actual,url:asset.browser_download_url}
}))
const manifest=readFileSync(`${output}/latest.yml`,'utf8')
if(!manifest.includes('version: 0.0.1')||!manifest.includes('Novel-Writer-master-setup-0.0.1.exe'))throw Error('Wrong update manifest')
const tag=api('git/ref/tags/v0.0.1')
if(tag.object.type!=='commit'||tag.object.sha!=='95af935525a7794fc8c3bd02a0c72531d9dc31cc')throw Error('Unexpected initial release source commit')
for(const architecture of ['arm64','x64']){
  const name=`Novel-Writer-master-mac-${architecture}-0.0.1-installer.dmg`
  const checksum=readFileSync(`${output}/${name}.sha256`,'utf8').trim().split(/\s+/)
  if(checksum[0]!==results.find(x=>x.name===name).sha256 || checksum[1]!==name)throw Error(`Invalid macOS checksum file: ${name}`)
}
results.push({name:'SHA256SUMS.txt',size:sumsBytes.length,sha256:sumsHash,url:sumsAsset.browser_download_url})
const result={version:'0.0.1',release:release.html_url,latest:latest.tag_name,tagSha:tag.object.sha,assets:results}
writeFileSync(`${output}/verification.json`,JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({release:result.release,latest:result.latest,tagSha:result.tagSha,assets:results.length}))
