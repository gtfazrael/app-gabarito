/* eslint-disable */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  FileText, BarChart3, 
  Settings, Download, 
  Camera, X, Image as ImageIcon, ScanLine, Share2, Trash2, Save, FileUp, CheckCircle2, Focus, Copy, AlertTriangle
} from 'lucide-react';

const BOX_W = 1080;
const BOX_H = 1220;
const CHAMADA_H = 240; 
const MAX_ROWS = 25;   
const ROW_H = (BOX_H - CHAMADA_H) / MAX_ROWS; 
const COL_W = BOX_W / 4; 

export default function App() {
  const [view, setView] = useState('setup'); 
  
  const [nomeProva, setNomeProva] = useState('Simulado 1');
  const [turma, setTurma] = useState('9º Ano A');
  const [numQuestoes, setNumQuestoes] = useState(10);
  const [numAlternativas, setNumAlternativas] = useState(5);
  const [gabaritoOficial, setGabaritoOficial] = useState(Array(10).fill('A'));
  
  const [provasLidas, setProvasLidas] = useState([]);
  
  const [isScanning, setIsScanning] = useState(false);
  const [previewFolha, setPreviewFolha] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  
  // Estado para fallback de exportação (quando o Android bloqueia o download do arquivo CSV)
  const [csvFallbackData, setCsvFallbackData] = useState(null);
  const [permissaoNegada, setPermissaoNegada] = useState(false);
  
  const videoRef = useRef(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [streamAtivo, setStreamAtivo] = useState(null);
  
  const scanBufferRef = useRef([]);

  // === 1. MEMÓRIA OFFLINE ===
  useEffect(() => {
    try {
      const dadosSalvos = localStorage.getItem('gabaritoPro_dados_v8');
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
    } catch (e) { console.error("Erro na memória:", e); }
  }, []);

  useEffect(() => {
    try {
      const dadosParaSalvar = { provasLidas, gabaritoOficial, numAlternativas, nomeProva, turma };
      localStorage.setItem('gabaritoPro_dados_v8', JSON.stringify(dadosParaSalvar));
    } catch (e) { console.error("Erro ao salvar:", e); }
  }, [provasLidas, gabaritoOficial, numAlternativas, nomeProva, turma]);

  // === 2. CÂMERA E PERMISSÕES NATIVAS ===
  const pararCamera = () => {
    setIsCameraActive(false);
    if (streamAtivo) {
      streamAtivo.getTracks().forEach((track) => track.stop());
      setStreamAtivo(null);
    }
  };

  useEffect(() => { 
    if (view !== 'camera') pararCamera(); 
    return () => pararCamera(); 
  }, [view]);

  // Função dedicada para solicitar permissão ao Android
  const ligarCamera = async () => {
    setPermissaoNegada(false);
    try {
      // Este comando força o navegador/Android a exibir o pop-up de permissão
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } 
      });
      
      setStreamAtivo(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      scanBufferRef.current = []; 
      setIsCameraActive(true); 
    } catch(err) {
      // Se o usuário negou ou o Android bloqueou, registramos o erro para exibir instruções
      console.error("Erro de câmera:", err);
      setPermissaoNegada(true);
      setIsCameraActive(false);
    }
  };

  const alternativasInUse = useMemo(() => {
    const qtde = parseInt(numAlternativas) || 2;
    return ['A', 'B', 'C', 'D', 'E'].slice(0, Math.max(2, Math.min(5, qtde)));
  }, [numAlternativas]);

  // === 3. AUTO-SCANNER ESTABILIZADO ===
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

          const cropW = canvas.width * 0.90; 
          const cropH = canvas.height * 0.85;
          const cropX = (canvas.width - cropW) / 2; 
          const cropY = (canvas.height - cropH) / 2;

          const canvasRecortado = document.createElement('canvas');
          canvasRecortado.width = cropW; canvasRecortado.height = cropH;
          const ctxRecortado = canvasRecortado.getContext('2d');
          ctxRecortado.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

          const analise = analisarCanvasOMR(canvasRecortado);

          if (analise.validBox && analise.chamada !== "00") {
            const hashLeitura = analise.chamada + analise.respostas.join('');
            
            scanBufferRef.current.push({ hash: hashLeitura, dados: analise });
            if (scanBufferRef.current.length > 3) scanBufferRef.current.shift();

            if (scanBufferRef.current.length === 3 &&
                scanBufferRef.current[0].hash === hashLeitura &&
                scanBufferRef.current[1].hash === hashLeitura) {
                
                setProvasLidas(prev => {
                  const jaExiste = prev.find(p => p.chamada === analise.chamada && p.turma === turma && p.prova === nomeProva && (Date.now() - p.timestamp < 5000));
                  if (jaExiste) return prev; 
                  
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
                
                setToastMessage(`Salvo! Aluno Nº ${analise.chamada}`);
                scanBufferRef.current = []; 
                setTimeout(() => setToastMessage(''), 2000); 
            }
          } else {
             scanBufferRef.current = [];
          }
        } catch (e) {} 
      }, 300); 
    }
    return () => clearInterval(interval);
  }, [isCameraActive, toastMessage, view, alternativasInUse, numQuestoes, nomeProva, turma]);


  // === 4. GERADOR DE FOLHAS A4 ===
  const gerarFolhaNaTela = () => {
    try {
      const qCount = parseInt(numQuestoes) || 1;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = 1200; 
      canvas.height = 1700; 
      
      ctx.fillStyle = '#ffffff'; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = '#000000'; 
      ctx.font = 'bold 46px Arial'; 
      ctx.textAlign = 'center';
      ctx.fillText('FOLHA DE RESPOSTAS OMR', canvas.width / 2, 90);
      
      ctx.textAlign = 'left'; 
      ctx.font = '28px Arial';
      ctx.fillText(`Turma: ${turma}   |   Prova: ${nomeProva}`, 60, 180);
      ctx.fillText('Nome do Aluno: ________________________________________________________________', 60, 240);
      
      ctx.font = 'bold 22px Arial'; ctx.fillText('INSTRUÇÕES:', 60, 300);
      ctx.font = '20px Arial';
      ctx.fillText('- Pinte a bolinha TOTALMENTE ESCURA com caneta preta ou azul.', 60, 330);
      ctx.fillText('- Identifique o seu NÚMERO DE CHAMADA preenchendo a Dezena e a Unidade.', 60, 360);
      ctx.fillText('- PROFESSOR: Ao fotografar, enquadre toda a caixa preta espessa dentro da tela.', 60, 390);
      
      const boxStartX = 60;
      const boxStartY = 420;
      
      ctx.lineWidth = 10; 
      ctx.strokeStyle = '#000000';
      ctx.strokeRect(boxStartX, boxStartY, BOX_W, BOX_H);
      
      ctx.font = 'bold 24px Arial'; 
      ctx.fillStyle = '#000000';
      ctx.fillText('Nº CHAMADA:', boxStartX + 40, boxStartY + 50);
      
      ctx.font = 'bold 20px Arial';
      ctx.fillText('Dezena:', boxStartX + 40, boxStartY + 100);
      for(let d = 0; d <= 9; d++) {
          let cx = boxStartX + 160 + (d * 55); 
          let cy = boxStartY + 93;
          ctx.beginPath(); ctx.arc(cx, cy, 18, 0, 2 * Math.PI); ctx.lineWidth = 3; ctx.stroke();
          ctx.fillStyle = '#999999'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'; 
          ctx.fillText(d, cx, cy + 6); ctx.textAlign = 'left'; ctx.fillStyle = '#000000';
      }

      ctx.fillText('Unidade:', boxStartX + 40, boxStartY + 180);
      for(let u = 0; u <= 9; u++) {
          let cx = boxStartX + 160 + (u * 55); 
          let cy = boxStartY + 173;
          ctx.beginPath(); ctx.arc(cx, cy, 18, 0, 2 * Math.PI); ctx.lineWidth = 3; ctx.stroke();
          ctx.fillStyle = '#999999'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'; 
          ctx.fillText(u, cx, cy + 6); ctx.textAlign = 'left'; ctx.fillStyle = '#000000';
      }

      ctx.beginPath(); 
      ctx.moveTo(boxStartX, boxStartY + CHAMADA_H); 
      ctx.lineTo(boxStartX + BOX_W, boxStartY + CHAMADA_H); 
      ctx.lineWidth = 5; 
      ctx.stroke();

      for (let i = 0; i < qCount; i++) {
          let col = Math.floor(i / MAX_ROWS);
          let row = i % MAX_ROWS;
          
          let baseX = boxStartX + (col * COL_W);
          let cy = boxStartY + CHAMADA_H + (row * ROW_H) + (ROW_H / 2);
          
          ctx.font = 'bold 22px Arial'; 
          ctx.textAlign = 'right';
          ctx.fillText((i + 1) + '.', baseX + 60, cy + 8);
          ctx.textAlign = 'left';
          
          let altWidth = 200 / alternativasInUse.length;
          alternativasInUse.forEach((alt, aIdx) => {
              let cx = baseX + 80 + (aIdx * altWidth) + (altWidth / 2);
              ctx.beginPath(); ctx.arc(cx, cy, 14, 0, 2 * Math.PI); ctx.lineWidth = 3; ctx.stroke();
              ctx.font = 'bold 16px Arial'; ctx.fillStyle = '#999999'; ctx.textAlign = 'center';
              ctx.fillText(alt, cx, cy + 6); ctx.textAlign = 'left'; ctx.fillStyle = '#000000';
          });
      }
      
      setPreviewFolha(canvas.toDataURL('image/png'));
    } catch (e) {
      alert("Erro ao criar desenho da folha.");
    }
  };

  // === 5. MOTOR OMR GEOMÉTRICO (REFINADO PARA ERROS) ===
  const analisarCanvasOMR = (canvas) => {
    const qCount = parseInt(numQuestoes) || 1;
    const altCount = alternativasInUse.length;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const gray = (data[i] + data[i+1] + data[i+2]) / 3;
        if (gray < 80) { 
          if (x < minX) minX = x; 
          if (x > maxX) maxX = x; 
          if (y < minY) minY = y; 
          if (y > maxY) maxY = y; 
        }
      }
    }

    const gridW = maxX - minX; 
    const gridH = maxY - minY;
    
    const ratio = gridW / gridH;
    let validBox = (gridW > canvas.width * 0.45 && gridH > canvas.height * 0.45 && ratio > 0.75 && ratio < 1.05);

    if (!validBox) {
      return { validBox: false, chamada: '00', respostas: [] };
    }

    const scaleX = gridW / BOX_W; 
    const scaleY = gridH / BOX_H;

    const checkBubble = (relX, relY) => {
        const cx = minX + (relX * scaleX); 
        const cy = minY + (relY * scaleY);
        const rX = 5 * scaleX; 
        const rY = 5 * scaleY;
        let dark = 0, total = 0;
        for(let y = Math.floor(cy - rY); y <= Math.floor(cy + rY); y++) {
            for(let x = Math.floor(cx - rX); x <= Math.floor(cx + rX); x++) {
                 if(x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
                     const i = (y * canvas.width + x) * 4;
                     const gray = (data[i] + data[i+1] + data[i+2]) / 3;
                     if(gray < 100) dark++; 
                     total++;
                 }
            }
        }
        return total > 0 ? (dark / total) : 0;
    };

    let maxDez = 0, bestDez = 0;
    for(let d=0; d<=9; d++) {
       let val = checkBubble(160 + (d * 55), 93);
       if(val > maxDez) { maxDez = val; bestDez = d; }
    }
    if(maxDez < 0.35) bestDez = 0;

    let maxUni = 0, bestUni = 0;
    for(let u=0; u<=9; u++) {
       let val = checkBubble(160 + (u * 55), 173);
       if(val > maxUni) { maxUni = val; bestUni = u; }
    }
    if(maxUni < 0.35) bestUni = 0;
    
    let chamadaLida = `${bestDez}${bestUni}`;

    const respostas = [];
    const altWidth = 200 / altCount;

    for (let i = 0; i < qCount; i++) {
        let col = Math.floor(i / MAX_ROWS);
        let row = i % MAX_ROWS;
        let baseX = col * COL_W;
        let baseY = CHAMADA_H + (row * ROW_H);

        let bestAlt = '-'; 
        let maxAltDark = 0;
        
        for(let a=0; a < altCount; a++) {
            let relX = baseX + 80 + (a * altWidth) + (altWidth / 2);
            let relY = baseY + (ROW_H / 2);
            
            let val = checkBubble(relX, relY);
            if(val > maxAltDark) { maxAltDark = val; bestAlt = alternativasInUse[a]; }
        }
        if(maxAltDark < 0.35) bestAlt = '-';
        respostas.push(bestAlt);
    }
    
    return { validBox: true, chamada: chamadaLida, respostas: respostas };
  };

  // === 6. LEITURA DE ARQUIVOS EM LOTE (OFFLINE) ===
  const extrairProvaDoLote = (canvasBase) => {
    const cropW = canvasBase.width * 0.95;
    const cropH = canvasBase.height * 0.95;
    const cropX = (canvasBase.width - cropW) / 2;
    const cropY = (canvasBase.height - cropH) / 2;

    const canvasRecortado = document.createElement('canvas');
    canvasRecortado.width = cropW;
    canvasRecortado.height = cropH;
    const ctx = canvasRecortado.getContext('2d');
    ctx.drawImage(canvasBase, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const analise = analisarCanvasOMR(canvasRecortado);
    if (analise.validBox && analise.chamada !== "00") {
      return {
        id: Math.random().toString(36).substr(2, 9),
        chamada: analise.chamada,
        nome: `Aluno Nº ${analise.chamada}`,
        prova: nomeProva,
        turma: turma,
        respostas: analise.respostas,
        timestamp: Date.now()
      };
    }
    return null;
  };

  const handleFileUploadLote = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setIsScanning(true);
    
    try {
      let provasExtraidas = [];
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          const img = new Image();
          await new Promise((resolve) => {
            img.onload = () => {
              const canvasTotal = document.createElement('canvas');
              const scale = 1200 / img.width; 
              canvasTotal.width = 1200; 
              canvasTotal.height = img.height * scale;
              const ctxTotal = canvasTotal.getContext('2d');
              ctxTotal.drawImage(img, 0, 0, canvasTotal.width, canvasTotal.height);
              
              const prova = extrairProvaDoLote(canvasTotal);
              if(prova) provasExtraidas.push(prova);
              resolve();
            };
            img.onerror = resolve; 
            img.src = URL.createObjectURL(file);
          });
        }
      }

      if (provasExtraidas.length > 0) {
        setProvasLidas(prev => [...prev, ...provasExtraidas]);
        alert(`Lote processado! ${provasExtraidas.length} provas adicionadas.`);
      } else {
        alert("Atenção: O sistema não conseguiu alinhar as imagens. Evite arquivos PDF, use fotos diretas da galeria neste modo.");
      }
    } catch (err) {
      alert("Erro ao processar lote: " + err.message);
    } finally {
      setIsScanning(false);
      e.target.value = null; 
    }
  };

  const handleCameraCaptureBackup = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsScanning(true);
    const img = new Image();
    img.onload = () => {
      const canvasTotal = document.createElement('canvas');
      const scale = 1200 / img.width; 
      canvasTotal.width = 1200; 
      canvasTotal.height = img.height * scale;
      const ctxTotal = canvasTotal.getContext('2d');
      ctxTotal.drawImage(img, 0, 0, canvasTotal.width, canvasTotal.height);
      
      const prova = extrairProvaDoLote(canvasTotal);
      if (prova) {
        setProvasLidas(prev => [...prev, prova]);
        alert(`Sucesso! Aluno Nº ${prova.chamada} salvo.`);
      } else {
        alert("Falha na leitura. A foto está torta ou muito longe da caixa preta.");
      }
      setIsScanning(false);
    };
    img.onerror = () => { alert("Falha na imagem"); setIsScanning(false); };
    img.src = URL.createObjectURL(file);
  };

  // === 7. ESTATÍSTICAS E PLANILHAS ===
  const dadosProcessados = useMemo(() => {
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
    const porcentagemTurma = ((totalAcertosGeral / (provasLidas.length * qCount)) * 100).toFixed(1);

    return { ranking, porcentagemTurma };
  }, [provasLidas, gabaritoOficial, numQuestoes]);

  // FUNÇÃO BLINDADA DE EXPORTAÇÃO CSV (COM FALLBACK VISUAL)
  const exportarCSVSeguro = async () => {
    const qCount = parseInt(numQuestoes) || 1;
    if (!dadosProcessados) return; 
    
    let csv = `Turma,Prova,Chamada,Nome,Acertos,Nota (%),`;
    for (let i = 1; i <= qCount; i++) csv += `Q${i},`; 
    csv += "\n";
    
    dadosProcessados.ranking.forEach((aluno) => {
      csv += `"${aluno.turma}","${aluno.prova}","${aluno.chamada}","${aluno.nome}",${aluno.acertos},${aluno.porcentagem.toFixed(1)}%,`;
      aluno.respostas.forEach(resp => csv += `${resp},`);
      csv += "\n";
    });

    csv += "\n\n=== ALUNOS CRITICOS (ABAIXO DE 50%) ===\n";
    csv += "Turma,Chamada,Nome,Nota (%)\n";
    dadosProcessados.ranking.forEach((aluno) => {
      if (aluno.porcentagem < 50) csv += `"${aluno.turma}","${aluno.chamada}","${aluno.nome}",${aluno.porcentagem.toFixed(1)}%\n`;
    });

    csv += "\n\n=== DIFICULDADE (ERROS POR QUESTAO) ===\n";
    csv += "Questao,Total de Erros,Taxa de Erro (%)\n";
    for (let i = 0; i < qCount; i++) {
      let totalErrosQuestao = 0;
      dadosProcessados.ranking.forEach(aluno => {
        if (!aluno.correcao[i]) totalErrosQuestao++;
      });
      let taxaErro = ((totalErrosQuestao / provasLidas.length) * 100).toFixed(1);
      csv += `Questao ${i + 1},${totalErrosQuestao},${taxaErro}%\n`;
    }

    const fileName = `Resultados_${turma.replace(/[^a-z0-9]/gi, '_')}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

    try {
      const file = new File([blob], fileName, { type: "text/csv" });
      
      // Tenta compartilhar primeiro (método mais nativo no celular)
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'Resultados da Turma',
            text: 'Arquivo CSV gerado pelo GabaritoPro.'
          });
          return;
        } catch(e) {} // Se usuário cancelar, continua
      } 
      
      // Tenta o Download normal
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); 
      link.href = url; link.setAttribute('download', fileName);
      document.body.appendChild(link); 
      link.click(); 
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
    } catch (error) {
      // FALHA DE SEGURANÇA DO ANDROID -> Exibe o texto cru na tela para o professor copiar e colar!
      setCsvFallbackData(csv);
    }
  };

  const copiarCSVMenual = () => {
    if (csvFallbackData) {
      navigator.clipboard.writeText(csvFallbackData)
        .then(() => alert("✅ Dados copiados! Pode colar no Excel ou no WhatsApp."))
        .catch(() => alert("Erro ao copiar. Selecione o texto manualmente."));
    }
  };

  const getCellClassResult = (isCorreto, isBranco) => {
    let base = "p-2 text-center border-l border-white font-bold text-xs ";
    if (isCorreto) return base + "bg-blue-100 text-blue-700"; 
    if (isBranco) return base + "bg-slate-100 text-slate-400"; 
    return base + "bg-red-100 text-red-700";
  };

  return (
    <div className="min-h-screen font-sans bg-slate-100 pb-24 relative">
      <header className="bg-indigo-600 sticky top-0 z-40 px-4 py-4 shadow-md">
        <h1 className="text-center font-black tracking-tight text-2xl text-white">Gabarito<span className="text-indigo-200">Pro</span></h1>
      </header>

      <main className="px-4 py-6 max-w-2xl mx-auto">
        {/* ABA SETUP */}
        {view === 'setup' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex flex-col gap-4 mb-6 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <Settings className="w-6 h-6 text-indigo-600" />
                <h2 className="text-xl font-bold text-slate-800">1. Identificação</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Turma</label>
                  <input type="text" value={turma} onChange={(e) => setTurma(e.target.value)} className="w-full px-4 py-3 border rounded-xl text-md font-bold bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Prova</label>
                  <input type="text" value={nomeProva} onChange={(e) => setNomeProva(e.target.value)} className="w-full px-4 py-3 border rounded-xl text-md font-bold bg-slate-50" />
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Questões (Até 100)</label>
                <input type="number" value={numQuestoes} onChange={(e) => setNumQuestoes(e.target.value)} onBlur={() => {let v=parseInt(numQuestoes); if(isNaN(v)||v<1)v=1; if(v>100)v=100; setNumQuestoes(v); setGabaritoOficial(Array(v).fill('A'));}} className="w-full px-4 py-3 border rounded-xl text-lg font-bold bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Opções (2-5)</label>
                <input type="number" value={numAlternativas} onChange={(e) => setNumAlternativas(e.target.value)} onBlur={() => {let v=parseInt(numAlternativas); if(isNaN(v)||v<2)v=2; if(v>5)v=5; setNumAlternativas(v); setGabaritoOficial(prev=>prev.map(r=>['A','B','C','D','E'].slice(0,v).includes(r)?r:'A'));}} className="w-full px-4 py-3 border rounded-xl text-lg font-bold bg-slate-50" />
              </div>
            </div>
            
            <button type="button" onClick={gerarFolhaNaTela} className="mb-6 w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-4 rounded-xl font-bold shadow-md">
              <ImageIcon className="w-6 h-6" /> Gerar Folha A4 Padrão
            </button>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h3 className="text-sm font-bold text-slate-700 uppercase mb-4">Gabarito Oficial do Professor</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.isArray(gabaritoOficial) && gabaritoOficial.map((resp, index) => (
                  <div key={index} className="flex items-center gap-2 bg-white p-2 border rounded-lg shadow-sm">
                    <span className="w-8 text-sm font-black text-slate-400 text-right">{index + 1}.</span>
                    <select value={resp} onChange={(e) => {
                      const nv = [...gabaritoOficial]; nv[index] = e.target.value; setGabaritoOficial(nv);
                    }} className="flex-1 border-0 font-bold bg-transparent text-indigo-700 text-lg">
                      {alternativasInUse.map(alt => (<option key={alt} value={alt}>{alt}</option>))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ABA CÂMERA E LOTE */}
        {view === 'camera' && (
          <div className="max-w-xl mx-auto space-y-4">
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              
              {/* Aviso se a permissão foi negada no Android */}
              {permissaoNegada && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-lg">
                  <h3 className="font-bold text-red-700 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5"/> Permissão Necessária
                  </h3>
                  <p className="text-sm text-red-600 mt-2">
                    O Android bloqueou o acesso à câmera. Para corrigir isso:
                  </p>
                  <ul className="text-xs text-red-600 mt-2 list-disc ml-5 space-y-1">
                    <li>Vá em <strong>Configurações</strong> do seu celular.</li>
                    <li>Toque em <strong>Aplicativos</strong> e ache o GabaritoPro.</li>
                    <li>Toque em <strong>Permissões</strong> e permita a <strong>Câmera</strong>.</li>
                  </ul>
                  <button onClick={ligarCamera} className="mt-4 w-full bg-red-600 text-white py-2 rounded-lg font-bold text-sm">
                    Já autorizei, tentar novamente
                  </button>
                </div>
              )}

              {!isCameraActive ? (
                <div className="flex flex-col gap-4">
                  <div className="text-center font-bold text-slate-400 text-xs uppercase mb-2">Correção Rápida Ao Vivo</div>
                  
                  <button type="button" onClick={ligarCamera} className="w-full py-6 flex flex-col items-center gap-2 border-2 border-dashed rounded-xl font-bold bg-indigo-50 border-indigo-400 text-indigo-700 hover:bg-indigo-100">
                    <Focus className="w-10 h-10 mb-1" /> 
                    <span className="text-lg">Abrir Scanner (Câmera)</span>
                  </button>

                  <div className="relative flex py-5 items-center">
                      <div className="flex-grow border-t border-slate-200"></div>
                      <span className="flex-shrink-0 mx-4 text-slate-400 text-xs font-bold uppercase">Ou Arquivos (Lote)</span>
                      <div className="flex-grow border-t border-slate-200"></div>
                  </div>

                  <label className="w-full py-6 flex flex-col items-center gap-2 border-2 border-solid rounded-xl font-bold cursor-pointer bg-slate-800 border-slate-900 text-white hover:bg-slate-700">
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileUploadLote} disabled={isScanning} />
                    {isScanning ? (
                       <div className="flex flex-col items-center gap-2"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div> Lendo Arquivos...</div>
                    ) : (
                       <div className="flex flex-col items-center gap-2">
                         <FileUp className="w-10 h-10 mb-1 text-indigo-300" />
                         <span className="text-md">Upload de Imagens (Galeria)</span>
                         <span className="text-[10px] text-slate-400 font-normal text-center px-4">Tirou várias fotos das provas com o app de câmera? Faça o upload delas de uma vez por aqui.</span>
                       </div>
                    )}
                  </label>
                  
                  <label className="w-full py-4 flex flex-col items-center gap-2 border-2 border-dashed rounded-xl font-bold cursor-pointer bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100 mt-2">
                     <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCameraCaptureBackup} disabled={isScanning} />
                     <Camera className="w-6 h-6 mb-1 text-slate-400" />
                     <span className="text-sm">Tirar Foto Manual (Modo Backup)</span>
                  </label>
                </div>
              ) : (
                <div className="relative rounded-xl overflow-hidden bg-black border border-slate-800 shadow-inner flex flex-col items-center">
                  <video ref={videoRef} autoPlay={true} playsInline={true} muted={true} className="w-full h-auto max-h-[70vh] object-cover" />
                  
                  <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
                    <div className="w-[90%] h-[85%] border-4 border-green-400 border-dashed relative rounded shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                      <div className="absolute top-2 left-0 right-0 flex justify-center">
                         <div className="bg-black/80 px-3 py-1 rounded text-green-400 text-xs font-black uppercase tracking-wider">
                           Alinhe a borda preta da folha aqui e pare
                         </div>
                      </div>
                    </div>
                  </div>

                  {toastMessage && (
                    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                       <div className="bg-white px-6 py-8 rounded-2xl flex flex-col items-center shadow-2xl transform scale-110 transition-transform">
                          <CheckCircle2 className="w-16 h-16 text-green-500 mb-3" />
                          <p className="font-black text-slate-800 text-lg text-center">{toastMessage}</p>
                       </div>
                    </div>
                  )}
                  
                  <button type="button" onClick={pararCamera} className="absolute top-2 right-2 z-20 bg-red-600 p-2 rounded-full text-white shadow-lg border-2 border-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ABA RESULTADOS */}
        {view === 'results' && (
          <div>
            {!dadosProcessados || provasLidas.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-dashed shadow-sm">
                <FileText className="w-20 h-20 text-slate-200 mx-auto mb-4" />
                <p className="text-slate-500 font-bold text-lg">A Planilha está vazia.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
                    <p className="text-xs text-slate-400 uppercase font-black tracking-wider">Provas Lidas</p>
                    <p className="text-4xl font-black text-slate-800">{provasLidas.length}</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
                    <p className="text-xs text-slate-400 uppercase font-black tracking-wider">Média Geral</p>
                    <p className="text-4xl font-black text-green-600">{dadosProcessados.porcentagemTurma}%</p>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="p-4 border-b flex flex-col sm:flex-row justify-between items-center bg-slate-50 gap-3">
                    <h2 className="font-bold text-slate-800 flex items-center gap-2"><Save className="w-5 h-5 text-green-500" /> Notas da Turma</h2>
                    <button type="button" onClick={exportarCSVSeguro} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-xl text-sm font-bold shadow-md">
                      <Download className="w-5 h-5" /> Exportar Planilha (Excel/CSV)
                    </button>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100 text-slate-600 text-[10px] uppercase tracking-wider whitespace-nowrap">
                          <th className="p-2 border-b font-black text-center">T</th>
                          <th className="p-2 border-b font-black text-center">Nº</th>
                          <th className="p-2 border-b font-black text-center bg-indigo-50">Pts</th>
                          {gabaritoOficial.map((_, i) => (<th key={i} className="p-2 border-b text-center font-black">Q{i+1}</th>))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {dadosProcessados.ranking.map((aluno) => (
                          <tr key={aluno.id} className="hover:bg-slate-50">
                            <td className="p-2 text-slate-400 font-bold text-center text-xs whitespace-nowrap">{aluno.turma}</td>
                            <td className="p-2 text-slate-800 font-black text-center">{aluno.chamada}</td>
                            <td className="p-2 text-center font-black text-indigo-700 bg-indigo-50/30">{aluno.acertos}</td>
                            {aluno.respostas.map((resp, i) => (
                              <td key={i} className={getCellClassResult(aluno.correcao[i], resp === '-')}>{resp}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <button type="button" onClick={() => setShowClearConfirm(true)} className="w-full py-5 border-2 border-red-200 text-red-600 hover:bg-red-50 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                  <Trash2 className="w-5 h-5" /> Apagar todas as provas da memória
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <nav className="bg-white border-t border-slate-200 fixed bottom-0 left-0 right-0 z-40 flex justify-around shadow-[0_-4px_10px_rgba(0,0,0,0.05)] px-2 pb-safe">
        {[
          { id: 'setup', name: 'Configuração', icon: Settings },
          { id: 'camera', name: 'Scanner', icon: Camera },
          { id: 'results', name: 'Resultados', icon: BarChart3 }
        ].map(tab => (
          <button type="button" key={tab.id} onClick={() => setView(tab.id)} className={`flex flex-col items-center justify-center flex-1 py-3 text-xs font-bold transition-colors ${view === tab.id ? 'text-indigo-600 border-t-2 border-indigo-600' : 'text-slate-400 border-t-2 border-transparent hover:text-slate-500'}`}>
            <tab.icon className="w-6 h-6 mb-1" /><span>{tab.name}</span>
          </button>
        ))}
      </nav>

      {/* MODALS DA FOLHA */}
      {previewFolha && (
        <div className="fixed inset-0 z-50 bg-slate-900/95 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
          <button type="button" onClick={() => setPreviewFolha(null)} className="absolute top-4 right-4 bg-white/10 p-2 rounded-full text-white"><X className="w-8 h-8" /></button>
          
          <div className="bg-white p-3 rounded-2xl max-w-md w-full max-h-[60vh] overflow-y-auto mb-4 shadow-2xl relative">
            <div className="absolute top-0 left-0 right-0 bg-yellow-400 text-black text-center text-xs font-bold py-2 px-2 z-10 rounded-t-xl shadow">
              DICA: Pressione e segure o dedo sobre a folha para salvar na Galeria.
            </div>
            <img src={previewFolha} alt="Folha de Respostas" className="w-full h-auto mt-6 border border-slate-200 rounded-lg" style={{ WebkitTouchCallout: 'default', userSelect: 'auto', pointerEvents: 'auto' }} />
          </div>
          
          <div className="max-w-md w-full flex flex-col gap-3">
            <button type="button" onClick={async () => {
                try {
                  const byteString = atob(previewFolha.split(',')[1]);
                  const mimeString = previewFolha.split(',')[0].split(':')[1].split(';')[0];
                  const ab = new ArrayBuffer(byteString.length);
                  const ia = new Uint8Array(ab);
                  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                  const blob = new Blob([ab], {type: mimeString});
                  const file = new File([blob], `Gabarito_${turma.replace(/[^a-z0-9]/gi, '_')}.png`, { type: "image/png" });
                  
                  if (navigator.share) await navigator.share({ files: [file], title: 'Gabarito' });
                } catch(e) { alert("Pressione o dedo na imagem acima para salvar."); }
            }} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-4 rounded-xl font-black text-lg flex items-center justify-center gap-2 shadow-lg">
              <Share2 className="w-6 h-6" /> Enviar Arquivo ou Imprimir
            </button>
          </div>
        </div>
      )}

      {/* MODALS FALLBACK CSV */}
      {csvFallbackData && (
         <div className="fixed inset-0 z-50 bg-slate-900/90 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
           <div className="bg-white p-5 rounded-2xl max-w-md w-full shadow-2xl flex flex-col">
             <div className="flex justify-between items-center mb-4 border-b pb-2">
                <h3 className="font-bold text-slate-800 text-lg">Bloqueio do Android</h3>
                <button onClick={() => setCsvFallbackData(null)}><X className="w-6 h-6 text-slate-400"/></button>
             </div>
             <p className="text-sm text-slate-600 mb-4">O seu celular bloqueou o download automático do arquivo. Mas não se preocupe! Clique em copiar e cole no Excel, Bloco de Notas ou WhatsApp.</p>
             <textarea readOnly value={csvFallbackData} className="w-full h-40 bg-slate-50 border rounded-lg p-2 text-xs font-mono text-slate-700 mb-4"></textarea>
             <button onClick={copiarCSVMenual} className="w-full bg-green-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2">
                <Copy className="w-5 h-5"/> Copiar Dados
             </button>
           </div>
         </div>
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl max-w-sm w-full shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 className="w-8 h-8 text-red-600" /></div>
            <h3 className="font-black text-xl text-slate-800 mb-2">Apagar Dados?</h3>
            <p className="text-slate-500 mb-6 text-sm">Tem certeza de que deseja apagar as notas desta turma? Ação irreversível.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowClearConfirm(false)} className="flex-1 py-3 font-bold text-slate-600 bg-slate-100 rounded-xl">Cancelar</button>
              <button type="button" onClick={() => {setProvasLidas([]); setShowClearConfirm(false);}} className="flex-1 py-3 font-bold text-white bg-red-600 rounded-xl">Sim, Apagar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
