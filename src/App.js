/* eslint-disable */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  FileText, BarChart3, Settings, Download, 
  Camera, X, Image as ImageIcon, ScanLine, 
  Share2, Trash2, Save, FileUp, CheckCircle2, 
  Focus, Copy, AlertTriangle, Printer
} from 'lucide-react';

// === CONSTANTES GEOMÉTRICAS DA FOLHA UNIVERSAL ===
// A folha sempre terá a proporção baseada nesta âncora (Retângulo Preto).
const ANCHOR_W = 1000;
const ANCHOR_H = 1300;
const HEADER_H = 260; // Espaço do Número da Chamada
const MAX_ROWS = 25;  // 25 linhas * 4 colunas = 100 questões máximas
const ROW_H = (ANCHOR_H - HEADER_H) / MAX_ROWS; 
const COL_W = ANCHOR_W / 4; 

export default function App() {
  const [view, setView] = useState('setup'); 
  
  const [nomeProva, setNomeProva] = useState('Avaliação Bimestral');
  const [turma, setTurma] = useState('9º Ano A');
  const [numQuestoes, setNumQuestoes] = useState(10);
  const [numAlternativas, setNumAlternativas] = useState(5);
  const [gabaritoOficial, setGabaritoOficial] = useState(Array(10).fill('A'));
  
  const [provasLidas, setProvasLidas] = useState([]);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewFolha, setPreviewFolha] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  
  const [csvFallbackData, setCsvFallbackData] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  
  const videoRef = useRef(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [streamAtivo, setStreamAtivo] = useState(null);
  
  const scanBufferRef = useRef([]); // Buffer para evitar falsos positivos

  // ==========================================
  // 1. SISTEMA DE SALVAMENTO (AUTO-SAVE)
  // ==========================================
  useEffect(() => {
    try {
      const dadosSalvos = localStorage.getItem('GabaritoPro_App_DB');
      if (dadosSalvos) {
        const parsed = JSON.parse(dadosSalvos);
        if (parsed.provasLidas) setProvasLidas(parsed.provasLidas);
        if (parsed.gabaritoOficial) {
          setGabaritoOficial(parsed.gabaritoOficial);
          setNumQuestoes(parsed.gabaritoOficial.length);
        }
        if (parsed.numAlternativas) setNumAlternativas(parsed.numAlternativas);
        if (parsed.nomeProva) setNomeProva(parsed.nomeProva);
        if (parsed.turma) setTurma(parsed.turma);
      }
    } catch (e) { console.error("Erro ao carregar dados", e); }
  }, []);

  useEffect(() => {
    try {
      const dados = { provasLidas, gabaritoOficial, numAlternativas, nomeProva, turma };
      localStorage.setItem('GabaritoPro_App_DB', JSON.stringify(dados));
    } catch (e) { console.error("Erro ao salvar dados", e); }
  }, [provasLidas, gabaritoOficial, numAlternativas, nomeProva, turma]);

  // ==========================================
  // 2. CONTROLE DA CÂMERA (COM FALLBACK)
  // ==========================================
  const desligarCamera = () => {
    setIsCameraActive(false);
    if (streamAtivo) {
      streamAtivo.getTracks().forEach(t => t.stop());
      setStreamAtivo(null);
    }
  };

  useEffect(() => { 
    if (view !== 'camera') desligarCamera(); 
    return () => desligarCamera(); 
  }, [view]);

  const ligarCamera = async () => {
    setCameraError(null);
    try {
      // Pede permissão explícita no Android
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } 
      });
      setStreamAtivo(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      scanBufferRef.current = []; 
      setIsCameraActive(true); 
    } catch(err) {
      setCameraError("O Android bloqueou a câmera. Use o botão 'Upload' ou ative a permissão nas Configurações do seu celular.");
      setIsCameraActive(false);
    }
  };

  const alternativasInUse = useMemo(() => {
    const qtde = parseInt(numAlternativas) || 2;
    return ['A', 'B', 'C', 'D', 'E'].slice(0, Math.max(2, Math.min(5, qtde)));
  }, [numAlternativas]);

  // ==========================================
  // 3. MOTOR OMR (LEITURA ÓPTICA RIGOROSA)
  // ==========================================
  const analisarImagemOMR = (canvas) => {
    const qCount = parseInt(numQuestoes) || 1;
    const altCount = alternativasInUse.length;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    
    // Varredura para encontrar a caixa preta espessa
    for (let y = 0; y < canvas.height; y += 2) { // Pula 2px para otimizar velocidade
      for (let x = 0; x < canvas.width; x += 2) {
        const i = (y * canvas.width + x) * 4;
        const gray = (data[i] + data[i+1] + data[i+2]) / 3;
        if (gray < 80) { // Limiar escuro
          if (x < minX) minX = x; 
          if (x > maxX) maxX = x; 
          if (y < minY) minY = y; 
          if (y > maxY) maxY = y; 
        }
      }
    }

    const boxW = maxX - minX; 
    const boxH = maxY - minY;
    
    // VALIDAÇÃO GEOMÉTRICA (Evita ler mesas, sombras e rostos)
    const ratio = boxW / boxH;
    const expectedRatio = ANCHOR_W / ANCHOR_H; // ~0.769
    
    // A caixa deve ocupar uma boa parte da imagem e ter a proporção correta
    const isValidRatio = ratio > (expectedRatio * 0.8) && ratio < (expectedRatio * 1.2);
    const isValidSize = boxW > canvas.width * 0.35 && boxH > canvas.height * 0.35;

    if (!isValidRatio || !isValidSize) {
      return { valid: false, chamada: '00', respostas: [] };
    }

    // Fatores de conversão da imagem lida para a nossa constante matemática
    const scaleX = boxW / ANCHOR_W; 
    const scaleY = boxH / ANCHOR_H;

    // Função que checa o preenchimento de uma bolinha específica
    const lerBolinha = (refX, refY) => {
        const cx = minX + (refX * scaleX); 
        const cy = minY + (refY * scaleY);
        const radius = 6 * scaleX; // Analisa apenas o "miolo" da bolinha
        
        let escuros = 0, total = 0;
        for(let y = Math.floor(cy - radius); y <= Math.floor(cy + radius); y++) {
            for(let x = Math.floor(cx - radius); x <= Math.floor(cx + radius); x++) {
                 if(x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
                     const i = (y * canvas.width + x) * 4;
                     const gray = (data[i] + data[i+1] + data[i+2]) / 3;
                     if(gray < 110) escuros++; 
                     total++;
                 }
            }
        }
        // Retorna a porcentagem de preenchimento (0.0 a 1.0)
        return total > 0 ? (escuros / total) : 0;
    };

    // 3.1 Ler Número de Chamada
    let maxDez = 0, bestDez = 0;
    for(let d = 0; d <= 9; d++) {
       let val = lerBolinha(180 + (d * 55), 100);
       if(val > maxDez) { maxDez = val; bestDez = d; }
    }
    if(maxDez < 0.35) bestDez = 0; // Se marcou fraco, assume 0

    let maxUni = 0, bestUni = 0;
    for(let u = 0; u <= 9; u++) {
       let val = lerBolinha(180 + (u * 55), 180);
       if(val > maxUni) { maxUni = val; bestUni = u; }
    }
    if(maxUni < 0.35) bestUni = 0;
    
    let chamada = `${bestDez}${bestUni}`;

    // 3.2 Ler Respostas
    const respostas = [];
    const altWidth = 200 / altCount;

    for (let i = 0; i < qCount; i++) {
        let col = Math.floor(i / MAX_ROWS);
        let row = i % MAX_ROWS;
        let startX = col * COL_W;
        let startY = CHAMADA_H + (row * ROW_H);

        let bestAlt = '-'; 
        let maxAlt = 0;
        
        for(let a = 0; a < altCount; a++) {
            // Calcula o centro da bolinha baseado nas coordenadas fixas da folha impressa
            let cx = startX + 90 + (a * altWidth) + (altWidth / 2);
            let cy = startY + (ROW_H / 2);
            
            let val = lerBolinha(cx, cy);
            if(val > maxAlt) { maxAlt = val; bestAlt = alternativasInUse[a]; }
        }
        
        if(maxAlt < 0.35) bestAlt = '-'; // Em branco ou muito claro
        respostas.push(bestAlt);
    }
    
    return { valid: true, chamada, respostas };
  };

  // ==========================================
  // 4. AUTO-SCAN (TEMPO REAL) COM DEBOUNCE
  // ==========================================
  useEffect(() => {
    let interval;
    if (isCameraActive && !toastMessage && view === 'camera') {
      interval = setInterval(() => {
        try {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          
          const video = videoRef.current;
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Corta uma área central para evitar sujeira nas bordas da câmera
          const cropW = canvas.width * 0.85; 
          const cropH = canvas.height * 0.90;
          const cropX = (canvas.width - cropW) / 2; 
          const cropY = (canvas.height - cropH) / 2;

          const canvasCortado = document.createElement('canvas');
          canvasCortado.width = cropW; canvasCortado.height = cropH;
          canvasCortado.getContext('2d').drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

          const analise = analisarImagemOMR(canvasCortado);

          if (analise.valid && analise.chamada !== "00") {
            const hashId = analise.chamada + analise.respostas.join('');
            scanBufferRef.current.push({ hash: hashId, dados: analise });
            if (scanBufferRef.current.length > 2) scanBufferRef.current.shift(); // Guarda só as últimas 2 leituras

            // Só processa se leu a mesma coisa em 2 quadros seguidos (Ignora tremores e borrões)
            if (scanBufferRef.current.length === 2 && scanBufferRef.current[0].hash === hashId) {
                
                setProvasLidas(prev => {
                  // Evita re-salvar o mesmo aluno se a câmera ficar parada na mesma folha
                  const recente = prev.find(p => p.chamada === analise.chamada && p.prova === nomeProva && (Date.now() - p.timestamp < 6000));
                  if (recente) return prev; 
                  
                  return [...prev, {
                    id: Math.random().toString(36).substr(2, 9),
                    chamada: analise.chamada,
                    nome: `Aluno Nº ${analise.chamada}`,
                    prova: nomeProva,
                    turma: turma,
                    respostas: analise.respostas,
                    timestamp: Date.now()
                  }];
                });
                
                setToastMessage(`Salvo! Chamada: ${analise.chamada}`);
                scanBufferRef.current = []; 
                setTimeout(() => setToastMessage(''), 2500); // 2.5s de pausa para trocar de folha
            }
          } else {
             scanBufferRef.current = []; // Reset se ler lixo
          }
        } catch (e) {} 
      }, 400); 
    }
    return () => clearInterval(interval);
  }, [isCameraActive, toastMessage, view, alternativasInUse, numQuestoes, nomeProva, turma]);


  // ==========================================
  // 5. PROCESSAMENTO DE LOTE (PDF E IMAGENS)
  // ==========================================
  const carregarPdfJs = async () => {
    if (window.pdfjsLib) return window.pdfjsLib;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error("Conecte-se à internet para usar o leitor de PDF pela primeira vez."));
      document.body.appendChild(script);
    });
  };

  const processarFolhaLote = (canvasBase) => {
    // Tira as bordas extremas que scanners de mesa geram
    const cW = canvasBase.width * 0.95;
    const cH = canvasBase.height * 0.95;
    const cX = (canvasBase.width - cW) / 2;
    const cY = (canvasBase.height - cH) / 2;

    const cvs = document.createElement('canvas');
    cvs.width = cW; cvs.height = cH;
    cvs.getContext('2d').drawImage(canvasBase, cX, cY, cW, cH, 0, 0, cW, cH);

    const result = analisarImagemOMR(cvs);
    if (result.valid && result.chamada !== "00") {
      return {
        id: Math.random().toString(36).substr(2, 9),
        chamada: result.chamada,
        nome: `Aluno Nº ${result.chamada}`,
        prova: nomeProva,
        turma: turma,
        respostas: result.respostas,
        timestamp: Date.now()
      };
    }
    return null;
  };

  const handleUploadLote = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setIsProcessing(true);
    
    try {
      let novasProvas = [];
      for (const file of files) {
        if (file.type === 'application/pdf') {
          const pdfjs = await carregarPdfJs();
          const buffer = await file.arrayBuffer();
          const pdf = await pdfjs.getDocument(buffer).promise;
          
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 2.0 }); // Escala 2.0 para alta resolução
            const cvs = document.createElement('canvas');
            cvs.width = vp.width; cvs.height = vp.height;
            await page.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
            
            const prova = processarFolhaLote(cvs);
            if(prova) novasProvas.push(prova);
          }
        } else if (file.type.startsWith('image/')) {
          const img = new Image();
          await new Promise(resolve => {
            img.onload = () => {
              const cvs = document.createElement('canvas');
              const scale = 1400 / img.width; // Padroniza o tamanho
              cvs.width = 1400; cvs.height = img.height * scale;
              cvs.getContext('2d').drawImage(img, 0, 0, cvs.width, cvs.height);
              
              const prova = processarFolhaLote(cvs);
              if(prova) novasProvas.push(prova);
              resolve();
            };
            img.onerror = resolve;
            img.src = URL.createObjectURL(file);
          });
        }
      }

      if (novasProvas.length > 0) {
        setProvasLidas(prev => [...prev, ...novasProvas]);
        alert(`Concluído! ${novasProvas.length} provas adicionadas com sucesso.`);
      } else {
        alert("Erro: O sistema não identificou a caixa preta do gabarito em nenhuma das imagens enviadas.");
      }
    } catch (err) {
      alert("Erro ao processar: " + err.message);
    } finally {
      setIsProcessing(false);
      e.target.value = null; 
    }
  };


  // ==========================================
  // 6. GERADOR DE FOLHAS A4 (PADRÃO UNIVERSAL)
  // ==========================================
  const gerarFolhaNaTela = () => {
    try {
      const qCount = parseInt(numQuestoes) || 1;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = 1240; // Proporção A4 Padrão
      canvas.height = 1754; 
      
      ctx.fillStyle = '#ffffff'; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = '#000000'; 
      ctx.font = 'bold 48px Arial'; 
      ctx.textAlign = 'center';
      ctx.fillText('FOLHA DE RESPOSTAS', canvas.width / 2, 80);
      
      ctx.textAlign = 'left'; 
      ctx.font = '26px Arial';
      ctx.fillText(`Turma: ${turma}   |   Prova: ${nomeProva}`, 80, 150);
      ctx.fillText('Nome do Aluno: ____________________________________________________________________', 80, 210);
      
      ctx.font = 'bold 20px Arial'; ctx.fillText('INSTRUÇÕES DE PREENCHIMENTO E CORREÇÃO:', 80, 280);
      ctx.font = '18px Arial';
      ctx.fillText('- Pinte a bolinha TOTALMENTE ESCURA usando caneta preta ou azul.', 80, 310);
      ctx.fillText('- É obrigatório preencher a sua DEZENA e UNIDADE no número da chamada.', 80, 340);
      ctx.fillText('- PROFESSOR: Enquadre toda a CAIXA PRETA abaixo na tela do aplicativo.', 80, 370);
      
      // CAIXA DE ANCORAGEM (Sempre Fixa)
      const boxX = (canvas.width - ANCHOR_W) / 2; // Centralizado
      const boxY = 420;
      
      ctx.lineWidth = 12; // Borda bem grossa para facilitar reconhecimento
      ctx.strokeStyle = '#000000';
      ctx.strokeRect(boxX, boxY, ANCHOR_W, ANCHOR_H);
      
      // Cabeçalho da Chamada
      ctx.font = 'bold 24px Arial'; 
      ctx.fillStyle = '#000000';
      ctx.fillText('Nº CHAMADA:', boxX + 40, boxY + 60);
      
      ctx.font = 'bold 20px Arial';
      ctx.fillText('Dezena:', boxX + 40, boxY + 110);
      for(let d = 0; d <= 9; d++) {
          let cx = boxX + 180 + (d * 55); 
          let cy = boxY + 100;
          ctx.beginPath(); ctx.arc(cx, cy, 18, 0, 2 * Math.PI); ctx.lineWidth = 3; ctx.stroke();
          ctx.fillStyle = '#999999'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'; 
          ctx.fillText(d, cx, cy + 6); ctx.textAlign = 'left'; ctx.fillStyle = '#000000';
      }

      ctx.fillText('Unidade:', boxX + 40, boxY + 190);
      for(let u = 0; u <= 9; u++) {
          let cx = boxX + 180 + (u * 55); 
          let cy = boxY + 180;
          ctx.beginPath(); ctx.arc(cx, cy, 18, 0, 2 * Math.PI); ctx.lineWidth = 3; ctx.stroke();
          ctx.fillStyle = '#999999'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'; 
          ctx.fillText(u, cx, cy + 6); ctx.textAlign = 'left'; ctx.fillStyle = '#000000';
      }

      ctx.beginPath(); 
      ctx.moveTo(boxX, boxY + CHAMADA_H); 
      ctx.lineTo(boxX + ANCHOR_W, boxY + CHAMADA_H); 
      ctx.lineWidth = 6; 
      ctx.stroke();

      // Desenhando as Questões
      for (let i = 0; i < qCount; i++) {
          let col = Math.floor(i / MAX_ROWS);
          let row = i % MAX_ROWS;
          
          let baseX = boxX + (col * COL_W);
          let cy = boxY + CHAMADA_H + (row * ROW_H) + (ROW_H / 2);
          
          ctx.font = 'bold 22px Arial'; 
          ctx.textAlign = 'right';
          ctx.fillText((i + 1) + '.', baseX + 70, cy + 8);
          ctx.textAlign = 'left';
          
          let altWidth = 200 / alternativasInUse.length;
          alternativasInUse.forEach((alt, aIdx) => {
              let cx = baseX + 90 + (aIdx * altWidth) + (altWidth / 2);
              ctx.beginPath(); ctx.arc(cx, cy, 15, 0, 2 * Math.PI); ctx.lineWidth = 3; ctx.stroke();
              ctx.font = 'bold 16px Arial'; ctx.fillStyle = '#999999'; ctx.textAlign = 'center';
              ctx.fillText(alt, cx, cy + 6); ctx.textAlign = 'left'; ctx.fillStyle = '#000000';
          });
      }
      
      setPreviewFolha(canvas.toDataURL('image/png'));
    } catch (e) {
      alert("Erro ao criar desenho da folha.");
    }
  };

  // Funções Nativas de Exportação de Folha
  const fecharModalFolha = () => setPreviewFolha(null);

  const baixarPDFNativo = () => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      iframe.contentDocument.write(`
        <html><head><title>Imprimir Gabarito</title></head>
        <body style="margin:0; text-align:center;">
          <img src="${previewFolha}" style="width:100%; max-width: 850px;" />
        </body></html>
      `);
      iframe.contentDocument.close();
      setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => document.body.removeChild(iframe), 1500);
      }, 500);
    } catch(e) {
      alert("Seu celular bloqueou a impressora. Tente compartilhar a imagem.");
    }
  };

  const compartilharFolhaNativa = async () => {
    try {
      const byteString = atob(previewFolha.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], {type: "image/png"});
      const file = new File([blob], `Folha_${turma.replace(/\s+/g, '_')}.png`, { type: "image/png" });
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Folha', text: 'Folha de Respostas GabaritoPro' });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); 
        link.href = url; link.download = `Folha_${turma.replace(/\s+/g, '_')}.png`; 
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
      }
    } catch(e) {
      alert("Para baixar: Pressione e segure o dedo em cima da folha na tela e escolha 'Fazer download da imagem'.");
    }
  };


  // ==========================================
  // 7. RELATÓRIOS E PLANILHA
  // ==========================================
  const relatorio = useMemo(() => {
    const qCount = parseInt(numQuestoes) || 1;
    if (provasLidas.length === 0) return null; 
    let totalAcertosGeral = 0;

    const alunosProcessados = provasLidas.map((aluno) => {
      let acertos = 0;
      const correcao = aluno.respostas.map((resp, index) => {
        const isCorreto = resp === gabaritoOficial[index];
        if (isCorreto) acertos++; 
        return isCorreto; 
      });
      totalAcertosGeral += acertos;
      return { ...aluno, acertos, porcentagem: (acertos / qCount) * 100, correcao };
    });

    const ranking = [...alunosProcessados].sort((a, b) => parseInt(a.chamada) - parseInt(b.chamada));
    const mediaSala = ((totalAcertosGeral / (provasLidas.length * qCount)) * 100).toFixed(1);

    return { ranking, mediaSala };
  }, [provasLidas, gabaritoOficial, numQuestoes]);

  const gerarCSV = async () => {
    const qCount = parseInt(numQuestoes) || 1;
    if (!relatorio) return; 
    
    let csv = `Turma,Prova,Chamada,Nome,Acertos,Nota(%),`;
    for (let i = 1; i <= qCount; i++) csv += `Q${i},`; 
    csv += "\n";
    
    relatorio.ranking.forEach((a) => {
      csv += `"${a.turma}","${a.prova}","${a.chamada}","${a.nome}",${a.acertos},${a.porcentagem.toFixed(1)}%,`;
      a.respostas.forEach(r => csv += `${r},`);
      csv += "\n";
    });

    csv += "\n\n=== ALUNOS CRITICOS (ABAIXO DE 50%) ===\n";
    csv += "Turma,Chamada,Nome,Nota(%)\n";
    relatorio.ranking.forEach((a) => {
      if (a.porcentagem < 50) csv += `"${a.turma}","${a.chamada}","${a.nome}",${a.porcentagem.toFixed(1)}%\n`;
    });

    csv += "\n\n=== INDICE DE DIFICULDADE (ERROS POR QUESTAO) ===\n";
    csv += "Questao,Total de Erros,Taxa de Erro na Sala (%)\n";
    for (let i = 0; i < qCount; i++) {
      let erros = 0;
      relatorio.ranking.forEach(a => { if (!a.correcao[i]) erros++; });
      let taxa = ((erros / provasLidas.length) * 100).toFixed(1);
      csv += `Questao ${i + 1},${erros},${taxa}%\n`;
    }

    const fileName = `Planilha_${turma.replace(/\s+/g, '_')}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

    try {
      const file = new File([blob], fileName, { type: "text/csv" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Planilha', text: 'Resultados da Correção' });
          return;
        } catch(e) {} // Ignora cancelamento de share
      } 
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); 
      link.href = url; link.setAttribute('download', fileName);
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
    } catch (error) {
      // Bloqueio do Android. Exibe o CSV como texto copiável.
      setCsvFallbackData(csv);
    }
  };


  // ==========================================
  // INTERFACE DE USUÁRIO (UI)
  // ==========================================
  return (
    <div className="min-h-screen font-sans bg-slate-100 pb-28 relative">
      <header className="bg-indigo-600 sticky top-0 z-40 px-4 py-5 shadow-lg flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-green-300 mr-2" />
        <h1 className="font-black tracking-tight text-xl text-white">Gabarito<span className="text-indigo-200">Pro</span></h1>
      </header>

      <main className="px-4 py-6 max-w-2xl mx-auto">
        
        {/* VIEW 1: CONFIGURAÇÃO */}
        {view === 'setup' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex flex-col gap-4 mb-6 border-b border-slate-100 pb-6">
              <div className="flex items-center gap-3">
                <Settings className="w-6 h-6 text-indigo-600" />
                <h2 className="text-xl font-bold text-slate-800">Metadados e Criação</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Sua Turma</label>
                  <input type="text" value={turma} onChange={(e) => setTurma(e.target.value)} className="w-full px-4 py-3 border rounded-xl text-md font-bold bg-slate-50 text-slate-700" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Nome da Prova</label>
                  <input type="text" value={nomeProva} onChange={(e) => setNomeProva(e.target.value)} className="w-full px-4 py-3 border rounded-xl text-md font-bold bg-slate-50 text-slate-700" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Total Questões</label>
                  <input type="number" value={numQuestoes} onChange={(e) => setNumQuestoes(e.target.value)} onBlur={() => {let v=parseInt(numQuestoes); if(isNaN(v)||v<1)v=1; if(v>100)v=100; setNumQuestoes(v); setGabaritoOficial(Array(v).fill('A'));}} className="w-full px-4 py-3 border rounded-xl text-lg font-bold bg-slate-50 text-slate-700" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Letras (Opções)</label>
                  <input type="number" value={numAlternativas} onChange={(e) => setNumAlternativas(e.target.value)} onBlur={() => {let v=parseInt(numAlternativas); if(isNaN(v)||v<2)v=2; if(v>5)v=5; setNumAlternativas(v); setGabaritoOficial(prev=>prev.map(r=>['A','B','C','D','E'].slice(0,v).includes(r)?r:'A'));}} className="w-full px-4 py-3 border rounded-xl text-lg font-bold bg-slate-50 text-slate-700" />
                </div>
              </div>
              <button type="button" onClick={gerarFolhaNaTela} className="mt-2 w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-4 rounded-xl font-bold shadow-md transition-all active:scale-95">
                <ImageIcon className="w-5 h-5" /> Gerar Folha A4 PDF
              </button>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h3 className="text-sm font-bold text-slate-700 uppercase mb-4">Gabarito Oficial do Professor</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.isArray(gabaritoOficial) && gabaritoOficial.map((resp, index) => (
                  <div key={index} className="flex items-center gap-2 bg-white p-2 border rounded-lg shadow-sm">
                    <span className="w-6 text-sm font-black text-slate-400 text-right">{index + 1}.</span>
                    <select value={resp} onChange={(e) => {
                      const nv = [...gabaritoOficial]; nv[index] = e.target.value; setGabaritoOficial(nv);
                    }} className="flex-1 border-0 font-bold bg-transparent text-indigo-600 text-lg p-1 outline-none">
                      {alternativasInUse.map(alt => (<option key={alt} value={alt}>{alt}</option>))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: SCANNER */}
        {view === 'camera' && (
          <div className="max-w-xl mx-auto space-y-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              
              {cameraError && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-lg">
                  <h3 className="font-bold text-red-700 flex items-center gap-2"><AlertTriangle className="w-5 h-5"/> Atenção</h3>
                  <p className="text-sm text-red-600 mt-2">{cameraError}</p>
                </div>
              )}

              {!isCameraActive ? (
                <div className="flex flex-col gap-4">
                  <h3 className="text-center font-bold text-slate-400 text-xs uppercase mb-2 tracking-widest">Correção Dinâmica</h3>
                  <button type="button" onClick={ligarCamera} className="w-full py-6 flex flex-col items-center gap-3 border-2 border-dashed rounded-2xl font-bold bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100 active:scale-95 transition-all">
                    <Focus className="w-12 h-12 mb-1" /> 
                    <span className="text-lg">Abrir Câmera do App</span>
                  </button>

                  <div className="relative flex py-6 items-center">
                      <div className="flex-grow border-t border-slate-200"></div>
                      <span className="flex-shrink-0 mx-4 text-slate-400 text-xs font-bold uppercase tracking-widest">Ou Arquivos de Mesa</span>
                      <div className="flex-grow border-t border-slate-200"></div>
                  </div>

                  <label className="w-full py-6 flex flex-col items-center gap-3 border-2 border-solid rounded-2xl font-bold cursor-pointer bg-slate-800 border-slate-900 text-white hover:bg-slate-700 shadow-md active:scale-95 transition-all">
                    <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handleUploadLote} disabled={isProcessing} />
                    {isProcessing ? (
                       <div className="flex flex-col items-center gap-2"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div> Lendo Arquivos...</div>
                    ) : (
                       <div className="flex flex-col items-center gap-2">
                         <FileUp className="w-10 h-10 mb-1 text-indigo-300" />
                         <span className="text-md">Upload de PDF ou Lote de Imagens</span>
                         <span className="text-[11px] text-slate-400 font-normal text-center px-6">Envie o arquivo escaneado na impressora ou selecione várias fotos da galeria.</span>
                       </div>
                    )}
                  </label>
                </div>
              ) : (
                <div className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-inner flex flex-col items-center h-[65vh]">
                  <video ref={videoRef} autoPlay={true} playsInline={true} muted={true} className="w-full h-full object-cover" />
                  
                  <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center p-4">
                    <div className="w-full h-[80%] border-4 border-green-400/80 border-dashed relative rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]">
                      <div className="absolute -top-10 left-0 right-0 flex justify-center">
                         <div className="bg-black/90 px-4 py-2 rounded-lg text-green-400 text-xs font-black uppercase tracking-widest">
                           Aponte para a Caixa Preta
                         </div>
                      </div>
                    </div>
                  </div>

                  {toastMessage && (
                    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                       <div className="bg-white px-8 py-8 rounded-3xl flex flex-col items-center shadow-2xl animate-in zoom-in duration-200">
                          <CheckCircle2 className="w-20 h-20 text-green-500 mb-4" />
                          <p className="font-black text-slate-800 text-2xl text-center">{toastMessage}</p>
                       </div>
                    </div>
                  )}
                  
                  <button type="button" onClick={pararCamera} className="absolute top-4 right-4 z-20 bg-red-600 p-3 rounded-full text-white shadow-lg border-2 border-white/50 active:scale-90">
                    <X className="w-6 h-6" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 3: RESULTADOS E PLANILHA */}
        {view === 'results' && (
          <div>
            {!relatorio || provasLidas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-dashed border-slate-300 shadow-sm">
                <FileText className="w-20 h-20 text-slate-200 mb-4" />
                <p className="text-slate-500 font-bold text-xl">Planilha Vazia</p>
                <p className="text-slate-400 text-sm mt-2">Vá na aba Scanner e corrija as provas.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">
                    <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1">Total Lidas</p>
                    <p className="text-5xl font-black text-slate-800">{provasLidas.length}</p>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-center">
                    <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1">Média Geral</p>
                    <p className="text-5xl font-black text-green-600">{relatorio.mediaSala}%</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="p-5 border-b flex flex-col sm:flex-row justify-between items-center bg-slate-50 gap-4">
                    <h2 className="font-bold text-slate-800 flex items-center gap-2 text-lg"><BarChart3 className="w-5 h-5 text-indigo-600" /> Relatório Analítico</h2>
                    <button type="button" onClick={gerarCSV} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-xl text-sm font-bold shadow-md active:scale-95 transition-all">
                      <Download className="w-5 h-5" /> Exportar Planilha
                    </button>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-max">
                      <thead>
                        <tr className="bg-slate-100 text-slate-500 text-[11px] uppercase tracking-wider">
                          <th className="p-3 border-b font-black text-center sticky left-0 bg-slate-100">Nº</th>
                          <th className="p-3 border-b font-black text-center bg-indigo-50/50">Nota</th>
                          {gabaritoOficial.map((_, i) => (<th key={i} className="p-3 border-b text-center font-bold">Q{i+1}</th>))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {relatorio.ranking.map((aluno) => {
                           const classNota = aluno.porcentagem < 50 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800';
                           return (
                            <tr key={aluno.id} className="hover:bg-slate-50">
                              <td className="p-3 text-slate-800 font-black text-center sticky left-0 bg-white border-r border-slate-100 shadow-[2px_0_4px_rgba(0,0,0,0.02)]">{aluno.chamada}</td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-1 rounded-md font-black ${classNota}`}>{aluno.porcentagem.toFixed(0)}%</span>
                              </td>
                              {aluno.respostas.map((resp, i) => (
                                <td key={i} className={`p-3 text-center font-bold border-l border-slate-50 ${aluno.correcao[i] ? 'text-slate-700' : resp==='-' ? 'text-slate-300' : 'text-red-500'}`}>{resp}</td>
                              ))}
                            </tr>
                           )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <button type="button" onClick={() => setShowClearConfirm(true)} className="w-full py-5 border-2 border-red-200 text-red-600 bg-white hover:bg-red-50 rounded-2xl text-sm font-bold flex justify-center items-center gap-2 active:scale-95 transition-all">
                  <Trash2 className="w-5 h-5" /> Iniciar Nova Turma (Apagar Lidas)
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MENU NAVEGAÇÃO INFERIOR */}
      <nav className="bg-white border-t border-slate-200 fixed bottom-0 left-0 right-0 z-40 flex justify-around px-2 pb-safe pt-2 shadow-[0_-10px_20px_rgba(0,0,0,0.03)]">
        {[
          { id: 'setup', name: 'Configuração', icon: Settings },
          { id: 'camera', name: 'Scanner', icon: Camera },
          { id: 'results', name: 'Relatório', icon: BarChart3 }
        ].map(tab => (
          <button type="button" key={tab.id} onClick={() => setView(tab.id)} className={`flex flex-col items-center justify-center flex-1 py-2 px-1 mb-2 rounded-xl transition-all ${view === tab.id ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-slate-600'}`}>
            <tab.icon className={`w-6 h-6 mb-1 ${view === tab.id ? 'fill-indigo-100' : ''}`} />
            <span className="text-[10px] font-black uppercase tracking-wider">{tab.name}</span>
          </button>
        ))}
      </nav>

      {/* MODAL: PRÉ-VISUALIZAR FOLHA */}
      {previewFolha && (
        <div className="fixed inset-0 z-50 bg-slate-900/95 flex flex-col items-center justify-center p-4 backdrop-blur-md">
          <button type="button" onClick={fecharModalFolha} className="absolute top-6 right-6 bg-white/20 p-2 rounded-full text-white"><X className="w-8 h-8" /></button>
          
          <div className="bg-white p-2 rounded-2xl max-w-md w-full max-h-[60vh] overflow-y-auto mb-6 shadow-2xl relative">
            <img src={previewFolha} alt="Folha de Respostas" className="w-full h-auto border border-slate-200 rounded-xl" style={{ WebkitTouchCallout: 'default', userSelect: 'auto', pointerEvents: 'auto' }} />
          </div>
          
          <div className="max-w-md w-full grid grid-cols-2 gap-3">
            <button type="button" onClick={baixarPDFNativo} className="w-full bg-slate-200 text-slate-800 py-4 rounded-xl font-black text-sm flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all">
              <Printer className="w-5 h-5" /> Salvar PDF
            </button>
            <button type="button" onClick={compartilharFolhaNativa} className="w-full bg-indigo-500 text-white py-4 rounded-xl font-black text-sm flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all">
              <Share2 className="w-5 h-5" /> Compartilhar
            </button>
          </div>
          <p className="text-white/60 text-center text-xs mt-4 max-w-xs leading-relaxed">
            Se os botões não funcionarem, pressione o dedo sobre a imagem branca e escolha "Fazer download".
          </p>
        </div>
      )}

      {/* MODAL: FALLBACK DA PLANILHA (SE O ANDROID BLOQUEAR O DOWNLOAD) */}
      {csvFallbackData && (
         <div className="fixed inset-0 z-50 bg-slate-900/90 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
           <div className="bg-white p-6 rounded-3xl max-w-md w-full shadow-2xl flex flex-col">
             <div className="flex justify-between items-center mb-4 border-b pb-4">
                <h3 className="font-black text-slate-800 text-xl flex items-center gap-2"><AlertTriangle className="w-6 h-6 text-amber-500"/> Atenção</h3>
                <button onClick={() => setCsvFallbackData(null)} className="bg-slate-100 p-2 rounded-full"><X className="w-5 h-5 text-slate-500"/></button>
             </div>
             <p className="text-sm text-slate-600 mb-4 font-medium leading-relaxed">O sistema de segurança do celular bloqueou a criação do arquivo CSV.<br/><br/><strong>Clique no botão abaixo e cole os dados em um arquivo do Excel ou no WhatsApp.</strong></p>
             <textarea readOnly value={csvFallbackData} className="w-full h-40 bg-slate-800 border-none rounded-xl p-3 text-[10px] font-mono text-green-400 mb-4 focus:outline-none"></textarea>
             <button onClick={() => { navigator.clipboard.writeText(csvFallbackData); alert("Dados copiados para a Área de Transferência!"); }} className="w-full bg-slate-800 hover:bg-slate-900 text-white py-4 rounded-xl font-black flex items-center justify-center gap-2 active:scale-95 transition-all">
                <Copy className="w-5 h-5"/> Copiar Dados
             </button>
           </div>
         </div>
      )}

      {/* MODAL: LIMPAR DADOS */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl max-w-sm w-full shadow-2xl text-center">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6"><Trash2 className="w-10 h-10 text-red-500" /></div>
            <h3 className="font-black text-2xl text-slate-800 mb-3">Apagar Tudo?</h3>
            <p className="text-slate-500 mb-8 font-medium">As notas e correções da turma <strong>{turma}</strong> serão excluídas permanentemente.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowClearConfirm(false)} className="flex-1 py-4 font-bold text-slate-600 bg-slate-100 rounded-xl active:bg-slate-200">Cancelar</button>
              <button type="button" onClick={() => {setProvasLidas([]); setShowClearConfirm(false);}} className="flex-1 py-4 font-bold text-white bg-red-500 rounded-xl active:bg-red-600 shadow-lg shadow-red-500/30">Sim, Apagar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
