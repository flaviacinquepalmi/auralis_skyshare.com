"""Rigenera i PDF dai testi versionati in legal/policies.json (richiede reportlab)."""
import json
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'legal/policies.json').read_text())
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='PolicyTitle',fontName='Helvetica-Bold',fontSize=24,leading=29,textColor=HexColor('#0A1628'),spaceAfter=12))
styles.add(ParagraphStyle(name='PolicyHeading',fontName='Helvetica-Bold',fontSize=11,leading=15,spaceBefore=14,spaceAfter=5,keepWithNext=True))
styles.add(ParagraphStyle(name='PolicyBody',fontName='Helvetica',fontSize=10,leading=15,spaceAfter=6))
styles.add(ParagraphStyle(name='PolicyMeta',fontName='Helvetica',fontSize=9,leading=13,textColor=HexColor('#556070'),spaceAfter=12))
styles.add(ParagraphStyle(name='PolicyDraft',fontName='Helvetica-Bold',fontSize=9,leading=13,textColor=HexColor('#8B341B'),spaceAfter=12))
def footer(canvas,doc):
 canvas.setFont('Helvetica',8);canvas.setFillColor(HexColor('#556070'))
 canvas.drawString(48,30,'Auralis SkyShare | v'+data['version']+' | '+data['updated'])
 canvas.drawRightString(547,30,str(doc.page))
for name,policy in data['documents'].items():
 path=root/'assets/legal'/f'{name}-v{data["version"]}.pdf'
 story=[Paragraph('AURALIS SKYSHARE',styles['PolicyMeta']),Paragraph(policy['title'],styles['PolicyTitle']),Paragraph(f'Versione {data["version"]} - Ultimo aggiornamento: {data["updated"]}',styles['PolicyMeta'])]
 if data['draft']:
  story.append(Paragraph('BOZZA DA COMPLETARE PRIMA DELLA PUBBLICAZIONE. Identità del titolare, durate effettive e trasferimenti da verificare.',styles['PolicyDraft']))
 for index,(heading,text) in enumerate(policy['sections']):
  if name == 'privacy-policy' and index == 4: story.append(PageBreak())
  story.extend([Paragraph(escape(heading),styles['PolicyHeading']),Paragraph(escape(text),styles['PolicyBody'])])
 SimpleDocTemplate(str(path),pagesize=(595.28,841.89),leftMargin=48,rightMargin=48,topMargin=42,bottomMargin=52,title=policy['title'],author='Auralis SkyShare').build(story,onFirstPage=footer,onLaterPages=footer)
 print(path.name)
