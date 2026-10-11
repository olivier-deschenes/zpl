/** Shown on first visit so the preview and click-to-code have something to show. */
export const SAMPLE_LABEL = `^XA
^FX Sample 4 x 6 in shipping label. Click anything in the preview to jump to its code.
^PW812
^LL1218
^CI28

^FX Sender
^CF0,30
^FO50,50^FDAcme Shipping Co.^FS
^CF0,24
^FO50,90^FD1234 Industrial Way^FS
^FO50,120^FDMontreal, QC H2X 1Y4^FS
^FO50,170^GB712,3,3^FS

^FX Recipient
^CF0,28
^FO50,200^FDShip to:^FS
^CF0,50
^FO50,240^FDJane Doe^FS
^CF0,36
^FO50,300^FD500 Market Street, Suite 12^FS
^FO50,345^FDToronto, ON M5V 2T6^FS
^FO50,400^GB712,3,3^FS

^FX Tracking barcode
^BY3,3,200
^FO70,440^BCN,200,Y,N,N^FD1Z999AA10123456784^FS

^FX Order details
^FO50,720^GB712,250,3^FS
^CF0,28
^FO80,750^FDOrder^FS
^FO80,860^FDWeight^FS
^CF0,44
^FO80,790^FDPO-2026-1010^FS
^FO80,900^FD2.4 kg^FS
^FO570,750^BQN,2,6^FDQA,https://example.com/track^FS

^FX Service banner
^FO50,1010^GB712,150,150^FS
^FO110,1050^FR^A0N,80,80^FDPRIORITY^FS
^XZ
`
