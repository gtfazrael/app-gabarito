import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  CheckCircle, BarChart3, Settings, Download, 
  Camera, X, FileImage, Plus, Trash2, Check, AlertTriangle,
  ChevronRight, ArrowRight
} from 'lucide-react';

export default function App() {
  const [view, setView] = useState('setup'); // 'setup', 'camera', 'results'
  const [numQuestoes, setNumQuestoes] = useState(10);
  const [numAlternativas, setNumAlternativas] = useState(5);
  const [gabaritoOficial, setGabaritoOficial] = useState(Array(10).fill('A'));
  
  const [provasLidas, setProvasLidas] = useState([]);
  const [nomeAlunoAtual, setNomeAlunoAtual] = useState('');
  
  // Estados da Câmera
  const videoRef = useRef(null);
  const [streamAtivo, setStreamAtivo] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const alternativasInUse = useMemo(() => ['A', 'B', 'C', 'D', 'E'].slice(0, numAlternativas), [numAlternativas]);

  useEffect(() => {
    // Se sair da aba da câmera, desliga a câmera para economizar bateria
    if (view !== 'camera') {
      pararCamera();
    } else {
      iniciarCamera();
    }
    return () => pararCamera();
  }, [view]);

  const handleNumQuestoesChange = (e) => {
    const val = parseInt(e.target.value) || 1;
    if (val > 0 && val <= 100) {
      setNumQuestoes(val);
      setGabaritoOficial(Array(val).fill('A'));
    }
  };

  const handleNumAlternativasChange = (e) => {
    const val = parseInt(e.target.value) || 2;
    if (val >= 2 && val <= 5) {
      setNumAlternativas(val);
      const novasAlternativas = ['A', 'B', 'C', 'D', 'E'].slice(0, val);
      setGabaritoOficial(prev => prev.map(resp => novasAlternativas.includes(resp) ? resp : 'A'));
    }
  };

  const handleGabaritoChange = (index, value) => {
    const novoGabarito = [...gabaritoOficial];
    novoGabarito[index] = value;
    setGabaritoOficial(novoGabarito);
  };

  const baixarFolhaPadrão = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Dimensões otimizadas
    canvas.width = 800;
    canvas.height = 350 + (numQuestoes * 60);
    
    // Fundo Branco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Textos e Cabeçalho
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('FOLHA DE RESPOSTAS OMR', canvas.width / 2, 60);
    
    ctx.textAlign = 'left';
    ctx.font = '22px Arial';
    ctx.fillText('Aluno(a): _________________________________________________', 50, 130);
    
    ctx.font = 'bold 16px Arial';
    ctx.fillText('INSTRUÇÕES PARA O APLICATIVO:', 50, 180);
    ctx.font = '16px Arial';
    ctx.fillText('- Preencha a bolinha inteira com caneta escura.', 50, 205);
    ctx.fillText('- Na hora de escanear, enquadre APENAS a caixa preta abaixo na câmera.', 50, 230);
    
    // Caixa delimitadora (Onde a câmera vai focar)
    const boxStartX = 50;
    const boxStartY = 280;
    const boxWidth = 700;
    const boxHeight = numQuestoes * 60;
    
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(boxStartX, boxStartY, boxWidth, boxHeight);
    
    // Desenhar Questões e Bolinhas
    for(let i = 0; i < numQuestoes; i++) {
      ctx.font = 'bold 24px Arial';
      ctx.fillStyle = '#000000';
      ctx.fillText((i + 1) + '.', boxStartX + 30, boxStartY + 40 + (i * 60));
      
      alternativasInUse.forEach((alt, aIdx) => {
        const cx = boxStartX + 150 + (aIdx * 100);
        const cy = boxStartY + 32 + (i * 60);
        
        ctx.beginPath();
        ctx.arc(cx, cy, 20, 0, 2 * Math.PI);
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = '#999999';
        ctx.textAlign = 'center';
        ctx.fillText(alt, cx, cy + 7);
        ctx.textAlign = 'left';
      });
    }
    
    const link = document.createElement('a');
    link.download = `Gabarito_${numQuestoes}_Questoes.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const analisarCanvasOMR = (canvas) => {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    
    // 1. Encontra os limites da tinta (Bounding Box)
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        if (gray < 130) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const gridW = maxX - minX;
    const gridH = maxY - minY;

    // Se a imagem estiver vazia ou com problema
    if (gridW <= 0 || gridH <= 0) return Array(numQuestoes).fill('-');

    const cellW = gridW / alternativasInUse.length;
    const cellH = gridH / numQuestoes;
    const respostas = [];

    // 2. Analisa cada célula da grade calculada
    for (let q = 0; q < numQuestoes; q++) {
      let maxDarkness = -1;
      let bestAlt = '-';

      for (let a = 0; a < alternativasInUse.length; a++) {
        const startX = Math.floor(minX + a * cellW + cellW * 0.25);
        const endX = Math.floor(minX + (a + 1) * cellW - cellW * 0.25);
        const startY = Math.floor(minY + q * cellH + cellH * 0.25);
        const endY = Math.floor(minY + (q + 1) * cellH - cellH * 0.25);

        let darkCount = 0;
        let totalCount = 0;

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = (y * canvas.width + x) * 4;
            const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
            if (gray < 140) darkCount++; 
            totalCount++;
          }
        }

        const darkness = darkCount / totalCount;
        if (darkness > maxDarkness) {
          maxDarkness = darkness;
          bestAlt = alternativasInUse[a];
        }
      }
      respostas.push(maxDarkness < 0.05 ? '-' : bestAlt);
    }
    return respostas;
  };

  const iniciarCamera = async () => {
    setCameraError('');
    try {
      // Prioriza a câmera traseira (environment) do celular
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStreamAtivo(stream);
    } catch (err) {
      setCameraError("Não foi possível acessar a câmera. Verifique as permissões do seu navegador.");
    }
  };

  const pararCamera = () => {
    if (streamAtivo) {
      streamAtivo.getTracks().forEach(track => track.stop());
      setStreamAtivo(null);
    }
  };

  const capturarCâmera = () => {
    if (!videoRef.current) return;
    setIsProcessing(true);

    setTimeout(() => {
      try {
        const video = videoRef.current;
        const canvasTotal = document.createElement('canvas');
        canvasTotal.width = video.videoWidth;
        canvasTotal.height = video.videoHeight;
        const ctxTotal = canvasTotal.getContext('2d');
        ctxTotal.drawImage(video, 0, 0, canvasTotal.width, canvasTotal.height);

        // A máscara na UI tem 80% de largura e 60% de altura. 
        // Calculamos o corte exato nos pixels nativos do vídeo.
        const cropW = canvasTotal.width * 0.8;
        const cropH = canvasTotal.height * 0.6;
        const cropX = (canvasTotal.width - cropW) / 2;
        const cropY = (canvasTotal.height - cropH) / 2;

        const canvasRecortado = document.createElement('canvas');
        canvasRecortado.width = cropW;
        canvasRecortado.height = cropH;
        const ctxRecortado = canvasRecortado.getContext('2d');
        
        ctxRecortado.drawImage(canvasTotal, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        const respostas = analisarCanvasOMR(canvasRecortado);

        // Se o nome estiver vazio, gera um automático (ex: Aluno 1, Aluno 2)
        const nomeFinal = nomeAlunoAtual.trim() || `Aluno ${provasLidas.length + 1}`;

        setProvasLidas(prev => [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          nome: nomeFinal,
          respostas: respostas
        }]);

        setNomeAlunoAtual('');
      } catch (err) {
        alert("Erro ao processar imagem.");
      } finally {
        setIsProcessing(false);
      }
    }, 100); // Timeout rápido para a UI mostrar o estado "Processando..."
  };

  const dadosProcessados = useMemo(() => {
    if (provasLidas.length === 0) return null;
    let totalAcertosTurma = 0;

    const alunosProcessados = provasLidas.map(aluno => {
      let acertos = 0;
      const correcao = aluno.respostas.map((resp, index) => {
        const isCorreto = resp === gabaritoOficial[index];
        if (isCorreto) acertos++;
        return isCorreto; 
      });

      totalAcertosTurma += acertos;
      return { 
        ...aluno, 
        acertos, 
        porcentagem: (acertos / numQuestoes) * 100, 
        correcao 
      };
    });

    // Classificação: da maior pontuação para a menor
    const ranking = [...alunosProcessados].sort((a, b) => b.acertos - a.acertos);
    const porcentagemTurma = ((totalAcertosTurma / (provasLidas.length * numQuestoes)) * 100).toFixed(1);

    return { ranking, porcentagemTurma };
  }, [provasLidas, gabaritoOficial, numQuestoes]);

  const exportarCSV = () => {
    if (!dadosProcessados) return;
    let csv = "Classificação,Nome,Acertos,Porcentagem,";
    for(let i=1; i<=numQuestoes; i++) csv += `Q${i},`;
    csv += "\n";
    
    dadosProcessados.ranking.forEach((aluno, index) => {
      csv += `${index + 1},"${aluno.nome}",${aluno.acertos},${aluno.porcentagem.toFixed(1)}%,`;
      aluno.respostas.forEach(resp => csv += `${resp},`);
      csv += "\n";
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Resultados_GabaritoPro.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderSetup = () => (
    <div className="pb-24 animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6">
        <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          <Settings className="text-indigo-600" /> Configurações da Prova
        </h2>
        
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Total de Questões</label>
            <input 
              type="number" inputMode="numeric" value={numQuestoes} onChange={handleNumQuestoesChange} 
              className="w-full text-lg px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" 
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Alternativas (A até E)</label>
            <input 
              type="number" inputMode="numeric" value={numAlternativas} onChange={handleNumAlternativasChange} min="2" max="5" 
              className="w-full text-lg px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" 
            />
          </div>
        </div>

        <button 
          onClick={baixarFolhaPadrão}
          className="w-full mt-6 bg-slate-800 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
        >
          <FileImage className="w-5 h-5" /> Baixar Folha de Respostas
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Gabarito Oficial</h3>
        <div className="grid grid-cols-2 gap-3">
          {gabaritoOficial.map((resp, index) => (
            <div key={index} className="flex items-center bg-slate-50 p-2 rounded-lg border border-slate-200">
              <span className="w-8 font-black text-slate-400 text-center">{index + 1}</span>
              <select 
                value={resp} 
                onChange={(e) => handleGabaritoChange(index, e.target.value)} 
                className="flex-1 bg-white border-0 font-bold text-indigo-700 text-lg py-2 focus:ring-0 cursor-pointer"
              >
                {alternativasInUse.map(alt => <option key={alt} value={alt}>{alt}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>
      
      <button 
        onClick={() => setView('camera')}
        className="fixed bottom-24 left-4 right-4 bg-indigo-600 text-white font-bold text-lg py-4 rounded-xl shadow-lg flex justify-center items-center gap-2 active:scale-95 transition-transform z-10"
      >
        Avançar para Scanner <ChevronRight className="w-6 h-6" />
      </button>
    </div>
  );

  const renderCamera = () => (
    <div className="h-[calc(100vh-80px)] flex flex-col bg-black absolute inset-0 z-50">
      {/* Top Bar Câmera */}
      <div className="bg-black/80 px-4 py-4 flex justify-between items-center text-white z-10">
        <h2 className="font-bold text-lg flex items-center gap-2"><Camera className="w-5 h-5"/> Scanner</h2>
        <button onClick={() => setView('setup')} className="bg-white/20 p-2 rounded-full"><X className="w-5 h-5"/></button>
      </div>

      {/* Input de Nome Flutuante */}
      <div className="absolute top-20 left-4 right-4 z-20">
        <input 
          type="text" 
          value={nomeAlunoAtual} 
          onChange={(e) => setNomeAlunoAtual(e.target.value)} 
          placeholder="Nome do Aluno (Opcional)"
          className="w-full px-5 py-4 bg-white/90 backdrop-blur-md rounded-2xl text-lg font-bold text-slate-800 placeholder-slate-500 shadow-xl border border-white/50 focus:outline-none"
        />
      </div>

      {/* Área da Câmera */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {cameraError ? (
          <div className="text-white text-center p-6 flex flex-col items-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
            <p className="font-bold mb-4">{cameraError}</p>
            <button onClick={iniciarCamera} className="bg-indigo-600 px-6 py-2 rounded-lg font-bold">Tentar Novamente</button>
          </div>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline className="absolute min-w-full min-h-full object-cover" />
            
            {/* Overlay Guia - Representa 80% larg x 60% alt */}
            <div className="absolute w-[80%] h-[60%] border-4 border-yellow-400/80 border-dashed rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] flex flex-col justify-between p-2">
              <div className="w-6 h-6 border-t-4 border-l-4 border-yellow-400"></div>
              <div className="w-full text-center text-white font-bold text-sm bg-black/50 py-1 rounded backdrop-blur-sm self-center">
                Enquadre a caixa das respostas
              </div>
              <div className="w-6 h-6 border-b-4 border-r-4 border-yellow-400 self-end"></div>
            </div>
          </>
        )}
      </div>

      {/* Controles Inferiores da Câmera */}
      <div className="bg-black/90 p-6 flex flex-col items-center gap-6 pb-safe">
        
        {/* Botão de Captura Estilo iOS */}
        <button 
          onClick={capturarCâmera}
          disabled={!streamAtivo || isProcessing}
          className="w-20 h-20 bg-white rounded-full border-4 border-slate-300 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50"
        >
          {isProcessing ? <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div> : <div className="w-16 h-16 bg-white border-2 border-slate-200 rounded-full"></div>}
        </button>

        <div className="w-full flex justify-between items-center">
          <div className="text-white font-medium bg-white/10 px-4 py-2 rounded-xl">
            <span className="font-bold text-green-400">{provasLidas.length}</span> Lidas
          </div>

          <button 
            onClick={() => setView('results')}
            disabled={provasLidas.length === 0}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all
              ${provasLidas.length > 0 ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-slate-800 text-slate-500'}`}
          >
            Gerar Planilha <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );

  const renderResults = () => {
    if (!dadosProcessados) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400 text-center px-4">
          <FileImage className="w-16 h-16 mb-4 text-slate-300" />
          <p className="font-bold text-lg text-slate-600 mb-2">Nenhuma prova escaneada</p>
          <p>Volte para a aba Câmera e comece a escanear as folhas de respostas.</p>
        </div>
      );
    }

    return (
      <div className="pb-24 animate-in fade-in">
        {/* Cards de Resumo */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center text-center">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Turma</p>
            <p className="text-3xl font-black text-slate-800">{provasLidas.length}</p>
            <p className="text-sm font-medium text-slate-500">Alunos</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center text-center">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Média</p>
            <p className="text-3xl font-black text-green-600">{dadosProcessados.porcentagemTurma}%</p>
            <p className="text-sm font-medium text-slate-500">Acertos</p>
          </div>
        </div>

        {/* Planilha Mobile-Friendly */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
          <div className="p-4 bg-slate-800 text-white flex justify-between items-center">
            <h2 className="font-bold text-lg">Classificação</h2>
            <button onClick={exportarCSV} className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1">
              <Download className="w-4 h-4"/> Excel
            </button>
          </div>
          
          {/* Scroll horizontal para a tabela não quebrar na tela pequena */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <th className="p-3 border-b font-black text-center w-12">#</th>
                  <th className="p-3 border-b font-black sticky left-0 bg-slate-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Aluno</th>
                  <th className="p-3 border-b font-black text-center bg-indigo-50/50">Nota</th>
                  {gabaritoOficial.map((_, i) => (
                    <th key={i} className="p-3 border-b text-center font-bold text-slate-400">Q{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {dadosProcessados.ranking.map((aluno, index) => (
                  <tr key={aluno.id} className="active:bg-slate-50">
                    <td className="p-3 text-center font-black text-slate-400">{index + 1}º</td>
                    <td className="p-3 font-bold text-slate-800 sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                      {aluno.nome}
                    </td>
                    <td className="p-3 text-center">
                      <span className="bg-indigo-100 text-indigo-800 font-black px-2 py-1 rounded-md">
                        {aluno.porcentagem.toFixed(0)}%
                      </span>
                    </td>
                    {aluno.respostas.map((resp, i) => {
                      const isCorreto = aluno.correcao[i];
                      const isBranco = resp === '-';
                      return (
                        <td key={i} className={`p-3 text-center font-black border-l border-white/50
                            ${isCorreto ? 'bg-blue-50 text-blue-600' : isBranco ? 'bg-slate-100 text-slate-400' : 'bg-red-50 text-red-500'}
                          `}>
                          {resp}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <button 
          onClick={() => {
            if(window.confirm("Isso apagará a planilha atual. Tem certeza?")) {
              setProvasLidas([]);
              setView('setup');
            }
          }}
          className="w-full flex items-center justify-center gap-2 text-red-500 font-bold py-4 active:bg-red-50 rounded-xl"
        >
          <Trash2 className="w-5 h-5"/> Limpar Dados e Recomeçar
        </button>
      </div>
    );
  };

  const BottomNav = () => (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 pb-safe pt-2 px-4 z-40 flex justify-around">
      <button 
        onClick={() => setView('setup')} 
        className={`flex flex-col items-center p-2 min-w-[80px] rounded-xl transition-colors ${view === 'setup' ? 'text-indigo-600' : 'text-slate-400'}`}
      >
        <Settings className={`w-6 h-6 mb-1 ${view === 'setup' ? 'fill-indigo-100' : ''}`} />
        <span className="text-[11px] font-bold">Configurar</span>
      </button>
      
      {/* Botão de Câmera Centralizado e em Destaque */}
      <button 
        onClick={() => setView('camera')} 
        className="relative -top-6 bg-indigo-600 text-white w-16 h-16 rounded-full flex items-center justify-center shadow-lg shadow-indigo-600/30 border-4 border-slate-100 active:scale-95 transition-transform"
      >
        <Camera className="w-7 h-7" />
      </button>
      
      <button 
        onClick={() => setView('results')} 
        className={`flex flex-col items-center p-2 min-w-[80px] rounded-xl transition-colors relative ${view === 'results' ? 'text-indigo-600' : 'text-slate-400'}`}
      >
        <BarChart3 className={`w-6 h-6 mb-1 ${view === 'results' ? 'fill-indigo-100' : ''}`} />
        <span className="text-[11px] font-bold">Planilha</span>
        {provasLidas.length > 0 && (
          <span className="absolute top-1 right-3 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></span>
        )}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 selection:bg-indigo-100">
      {/* Cabeçalho Fixo (Escondido na Câmera) */}
      {view !== 'camera' && (
        <header className="bg-indigo-600 text-white pt-safe sticky top-0 z-30 shadow-md">
          <div className="px-5 py-4 flex items-center gap-3">
            <CheckCircle className="w-7 h-7 text-green-300" />
            <h1 className="text-xl font-black tracking-tight">Gabarito<span className="text-indigo-200">Pro</span></h1>
          </div>
        </header>
      )}

      {/* Conteúdo Principal */}
      <main className={`p-4 ${view === 'camera' ? 'p-0' : ''}`}>
        {view === 'setup' && renderSetup()}
        {view === 'camera' && renderCamera()}
        {view === 'results' && renderResults()}
      </main>

      {/* Menu Inferior (Escondido na Câmera) */}
      {view !== 'camera' && <BottomNav />}
    </div>
  );
}
