```react
import React, { useState, useMemo } from 'react';
import { 
  Upload, CheckCircle, FileText, BarChart3, 
  Settings, Download, AlertCircle, ChevronRight,
  Camera, X, Image as ImageIcon
} from 'lucide-react';

export default function App() {
  const [view, setView] = useState('setup'); 
  const [numQuestoes, setNumQuestoes] = useState(10);
  const [numAlternativas, setNumAlternativas] = useState(5);
  const [gabaritoOficial, setGabaritoOficial] = useState(Array(10).fill('A'));
  const [provasLidas, setProvasLidas] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [arquivosUpload, setArquivosUpload] = useState([]);
  
  // Novo estado para mostrar a Folha de Respostas na tela
  const [previewFolha, setPreviewFolha] = useState(null);
  
  const [nomeAlunoCamera, setNomeAlunoCamera] = useState('');

  const alternativasInUse = useMemo(() => {
    const qtde = parseInt(numAlternativas) || 2;
    return ['A', 'B', 'C', 'D', 'E'].slice(0, Math.max(2, Math.min(5, qtde)));
  }, [numAlternativas]);

  // --- Handlers dos Inputs Numéricos ---
  const handleNumQuestoesChange = (e) => {
    const valStr = e.target.value;
    if (valStr === '') { setNumQuestoes(''); return; }
    const val = parseInt(valStr);
    if (!isNaN(val)) {
      setNumQuestoes(val);
      if (val > 0 && val <= 100) setGabaritoOficial(Array(val).fill('A'));
    }
  };

  const handleNumQuestoesBlur = () => {
    let val = parseInt(numQuestoes);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 100) val = 100;
    setNumQuestoes(val);
    setGabaritoOficial(Array(val).fill('A'));
  };

  const handleNumAlternativasChange = (e) => {
    const valStr = e.target.value;
    if (valStr === '') { setNumAlternativas(''); return; }
    const val = parseInt(valStr);
    if (!isNaN(val)) {
      setNumAlternativas(val);
      if (val >= 2 && val <= 5) {
        const novasAlternativas = ['A', 'B', 'C', 'D', 'E'].slice(0, val);
        setGabaritoOficial(prev => prev.map(resp => novasAlternativas.includes(resp) ? resp : 'A'));
      }
    }
  };

  const handleNumAlternativasBlur = () => {
    let val = parseInt(numAlternativas);
    if (isNaN(val) || val < 2) val = 2;
    if (val > 5) val = 5;
    setNumAlternativas(val);
    const novasAlternativas = ['A', 'B', 'C', 'D', 'E'].slice(0, val);
    setGabaritoOficial(prev => prev.map(resp => novasAlternativas.includes(resp) ? resp : 'A'));
  };

  // --- Gerador de Folha Padrão (Modal Image) ---
  const gerarFolhaNaTela = () => {
    const qCount = parseInt(numQuestoes) || 1;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = 800;
    canvas.height = 350 + (qCount * 60);
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('FOLHA DE RESPOSTAS', canvas.width / 2, 60);
    
    ctx.textAlign = 'left';
    ctx.font = '22px Arial';
    ctx.fillText('Aluno(a): _________________________________________________', 50, 130);
    
    ctx.font = 'bold 16px Arial';
    ctx.fillText('INSTRUÇÕES:', 50, 180);
    ctx.font = '16px Arial';
    ctx.fillText('- Preencha a bolinha completamente escura.', 50, 205);
    ctx.fillText('- Na hora de fotografar, enquadre APENAS a caixa preta abaixo.', 50, 230);
    
    const boxStartX = 50;
    const boxStartY = 280;
    const boxWidth = 700;
    const boxHeight = qCount * 60;
    
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(boxStartX, boxStartY, boxWidth, boxHeight);
    
    for(let i = 0; i < qCount; i++) {
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
    
    // Mostra a imagem na tela em vez de tentar baixar ocultamente
    setPreviewFolha(canvas.toDataURL('image/png'));
  };

  // --- Motor Analisador OMR ---
  const analisarCanvasOMR = (canvas) => {
    const qCount = parseInt(numQuestoes) || 1;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    
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

    if (gridW <= 0 || gridH <= 0) return Array(qCount).fill('-');

    const cellW = gridW / alternativasInUse.length;
    const cellH = gridH / qCount;
    const respuestas = [];

    for (let q = 0; q < qCount; q++) {
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
      respuestas.push(maxDarkness < 0.05 ? '-' : bestAlt);
    }
    return respuestas;
  };

  // --- Processamento de Imagem Universal (Upload e Câmera) ---
  const processarArquivoImagem = (file, nomeAluno) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 800 / img.width;
        canvas.width = 800;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const respostas = analisarCanvasOMR(canvas);
        resolve({
          id: Math.random().toString(36).substr(2, 9),
          nome: nomeAluno,
          respostas: respostas
        });
      };
      img.onerror = () => reject("Erro ao ler imagem");
      img.src = URL.createObjectURL(file);
    });
  };

  // --- Handlers de Upload ---
  const handleFileUpload = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setArquivosUpload(prev => [...prev, ...Array.from(e.target.files)]);
    }
  };

  const processarImagensUpload = async () => {
    if (arquivosUpload.length === 0) return;
    setIsScanning(true);
    try {
      const novosAlunos = await Promise.all(arquivosUpload.map(async (arquivo) => {
        const nomeGerado = arquivo.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
        return await processarArquivoImagem(arquivo, nomeGerado);
      }));
      setProvasLidas(prev => [...prev, ...novosAlunos]);
      setArquivosUpload([]);
    } catch (error) {
      alert("Erro ao processar as imagens.");
    } finally {
      setIsScanning(false);
    }
  };

  // --- Handlers da Câmera Nativa ---
  const handleCameraCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!nomeAlunoCamera.trim()) {
      alert("Por favor, digite o nome do aluno antes de tirar a foto.");
      return;
    }

    setIsScanning(true);
    try {
      const novaProva = await processarArquivoImagem(file, nomeAlunoCamera);
      setProvasLidas(prev => [...prev, novaProva]);
      setNomeAlunoCamera('');
      alert(`Prova de ${nomeAlunoCamera} escaneada com sucesso!`);
    } catch (error) {
      alert("Ocorreu um erro ao ler a foto.");
    } finally {
      setIsScanning(false);
    }
  };

  // --- Resultados e Dados ---
  const limparDados = () => {
    if(window.confirm("Apagar todos os dados da memória?")) setProvasLidas([]);
  };

  const dadosProcessados = useMemo(() => {
    const qCount = parseInt(numQuestoes) || 1;
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
      return { ...aluno, acertos, porcentagem: (acertos / qCount) * 100, correcao };
    });

    const ranking = [...alunosProcessados].sort((a, b) => b.acertos - a.acertos);
    const porcentagemTurma = ((totalAcertosTurma / (provasLidas.length * qCount)) * 100).toFixed(1);

    return { ranking, porcentagemTurma };
  }, [provasLidas, gabaritoOficial, numQuestoes]);

  // O botão de download CSV continua o mesmo, pois dados em texto puro (.csv) geralmente não dão problema em WebViews
  const exportarCSV = () => {
    const qCount = parseInt(numQuestoes) || 1;
    if (!dadosProcessados) return;
    let csv = "Nome,Acertos,%,";
    for(let i=1; i<=qCount; i++) csv += `Q${i},`;
    csv += "\n";
    dadosProcessados.ranking.forEach(aluno => {
      csv += `"${aluno.nome}",${aluno.acertos},${aluno.porcentagem.toFixed(1)}%,`;
      aluno.respostas.forEach(resp => csv += `${resp},`);
      csv += "\n";
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Resultados_Gabarito.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- RENDERS DAS TELAS ---
  const renderSetup = () => (
    <div className="max-w-3xl mx-auto bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="flex flex-col gap-4 mb-6 justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-indigo-600" />
          <h2 className="text-xl font-bold text-slate-800">1. Configurar Prova</h2>
        </div>
        <button 
          onClick={gerarFolhaNaTela}
          className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-3 rounded-lg font-bold transition-colors text-sm shadow-sm"
        >
          <ImageIcon className="w-5 h-5" /> Gerar Folha de Respostas
        </button>
      </div>
      
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Questões (1-100)</label>
          <input type="number" value={numQuestoes} onChange={handleNumQuestoesChange} onBlur={handleNumQuestoesBlur} className="w-full px-4 py-2 border rounded-lg text-lg focus:ring-2 focus:ring-indigo-500 font-bold" />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Opções (2-5)</label>
          <input type="number" value={numAlternativas} onChange={handleNumAlternativasChange} onBlur={handleNumAlternativasBlur} className="w-full px-4 py-2 border rounded-lg text-lg focus:ring-2 focus:ring-indigo-500 font-bold" />
        </div>
      </div>

      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
        <h3 className="text-sm font-bold text-slate-700 uppercase mb-4">Gabarito Oficial</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.isArray(gabaritoOficial) && gabaritoOficial.map((resp, index) => (
            <div key={index} className="flex items-center gap-2 bg-white p-2 border rounded-md shadow-sm">
              <span className="w-6 text-xs font-black text-slate-400 text-right">{index + 1}.</span>
              <select value={resp} onChange={(e) => {
                const nv = [...gabaritoOficial];
                nv[index] = e.target.value;
                setGabaritoOficial(nv);
              }} className="flex-1 border-0 font-bold bg-transparent text-indigo-700 focus:ring-0">
                {alternativasInUse.map(alt => <option key={alt} value={alt}>{alt}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderCamera = () => (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 mb-4 text-sm text-amber-800 font-medium">
        💡 <strong>Dica:</strong> Na hora de tirar a foto, preencha a tela do seu celular focando o máximo possível <strong>apenas na caixa retangular preta</strong> contendo as bolinhas.
      </div>

      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
        <div className="mb-6">
          <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Nome do Aluno:</label>
          <input 
            type="text" value={nomeAlunoCamera} onChange={(e) => setNomeAlunoCamera(e.target.value)} 
            placeholder="Ex: Ana Silva"
            className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 font-medium text-lg"
          />
        </div>

        <label className={`w-full py-6 flex flex-col items-center gap-3 border-2 border-dashed rounded-xl font-bold cursor-pointer transition-colors ${!nomeAlunoCamera.trim() ? 'bg-slate-50 border-slate-300 text-slate-400' : 'bg-indigo-50 border-indigo-400 text-indigo-700'}`}>
          <input 
            type="file" 
            accept="image/*" 
            capture="environment" // Este comando mágico invoca a câmera do celular diretamente!
            className="hidden" 
            onChange={handleCameraCapture} 
            disabled={!nomeAlunoCamera.trim() || isScanning} 
          />
          {isScanning ? (
            <div className="flex items-center gap-2 text-indigo-600">
               <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
               Analisando Pixels...
            </div>
          ) : (
            <>
              <Camera className="w-10 h-10" /> 
              <span>Tirar Foto da Prova</span>
            </>
          )}
        </label>
      </div>
    </div>
  );

  const renderUpload = () => (
    <div className="max-w-xl mx-auto bg-white p-6 rounded-xl border border-slate-200 text-center">
      <Upload className="w-10 h-10 text-indigo-600 mx-auto mb-3" />
      <h2 className="text-lg font-bold text-slate-800 mb-4">Upload de Galeria</h2>
      <label className="border-2 border-dashed border-indigo-200 bg-indigo-50/20 rounded-xl p-6 cursor-pointer block">
        <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileUpload} disabled={isScanning} />
        <span className="font-bold text-indigo-600 text-sm">Selecionar Fotos do Celular</span>
      </label>
      {arquivosUpload.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold text-slate-500 text-left mb-2">{arquivosUpload.length} arquivos selecionados.</p>
          <button onClick={processarImagensUpload} disabled={isScanning} className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold">
            {isScanning ? 'Processando...' : 'Processar Lote'}
          </button>
        </div>
      )}
    </div>
  );

  const renderResults = () => {
    if (!dadosProcessados) {
      return (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 font-medium">Nenhuma prova escaneada na memória.</p>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white p-4 rounded-xl border text-center">
            <p className="text-xs text-slate-400 uppercase font-black">Alunos Lidos</p>
            <p className="text-2xl font-black text-slate-800">{provasLidas.length}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border text-center">
            <p className="text-xs text-slate-400 uppercase font-black">Média</p>
            <p className="text-2xl font-black text-green-600">{dadosProcessados.porcentagemTurma}%</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="p-4 border-b flex justify-between items-center bg-slate-50">
            <h2 className="font-bold text-slate-800">Planilha</h2>
            <button onClick={exportarCSV} className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">
              <Download className="w-3.5 h-3.5" /> Baixar (.csv)
            </button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wider whitespace-nowrap">
                  <th className="p-3 border-b font-bold">#</th>
                  <th className="p-3 border-b font-bold">Aluno</th>
                  <th className="p-3 border-b font-bold text-center bg-indigo-50">Nota</th>
                  {gabaritoOficial.map((_, i) => (
                    <th key={i} className="p-3 border-b text-center font-bold">Q{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold">
                {dadosProcessados.ranking.map((aluno, index) => (
                  <tr key={aluno.id} className="hover:bg-slate-50/80">
                    <td className="p-3 text-slate-400">{index + 1}º</td>
                    <td className="p-3 text-slate-800 whitespace-nowrap">{aluno.nome}</td>
                    <td className="p-3 text-center text-indigo-700 bg-indigo-50/30">{aluno.acertos}</td>
                    {aluno.respostas.map((resp, i) => {
                      const isCorreto = aluno.correcao[i];
                      const isBranco = resp === '-';
                      return (
                        <td key={i} className={`p-3 text-center border-l border-white ${isCorreto ? 'bg-blue-100 text-blue-700' : isBranco ? 'bg-slate-100 text-slate-400' : 'bg-red-100 text-red-700'}`}>
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
        <button onClick={limparDados} className="w-full py-3 border border-red-200 text-red-600 rounded-lg text-sm font-bold bg-red-50">
          Zerar Memória
        </button>
      </div>
    );
  };

  const NavButton = ({ id, name, icon: Icon }) => (
    <button onClick={() => setView(id)} className={`flex flex-col items-center justify-center flex-1 py-2 text-xs font-bold transition-colors ${view === id ? 'text-indigo-600' : 'text-slate-400'}`}>
      <Icon className="w-5 h-5 mb-0.5" />
      <span>{name}</span>
    </button>
  );

  return (
    <div className="min-h-screen font-sans bg-slate-50 pb-20 relative">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-4 py-3 shadow-sm">
        <h1 className="text-center font-black tracking-tight text-lg text-slate-800">Gabarito<span className="text-indigo-600">Pro</span></h1>
      </header>

      <main className="px-4 py-6 max-w-md mx-auto">
        {view === 'setup' && renderSetup()}
        {view === 'camera' && renderCamera()}
        {view === 'upload' && renderUpload()}
        {view === 'results' && renderResults()}
      </main>

      <nav className="bg-white border-t border-slate-200 fixed bottom-0 left-0 right-0 z-40 flex justify-around shadow-lg px-2">
        <NavButton id="setup" name="Config" icon={Settings} />
        <NavButton id="camera" name="Câmera" icon={Camera} />
        <NavButton id="upload" name="Galeria" icon={Upload} />
        <NavButton id="results" name="Planilha" icon={BarChart3} />
      </nav>

      {/* Modal Segura para Download da Folha */}
      {previewFolha && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
          <button onClick={() => setPreviewFolha(null)} className="absolute top-4 right-4 bg-white/20 p-2 rounded-full text-white">
            <X className="w-6 h-6" />
          </button>
          
          <div className="bg-white p-2 rounded-xl max-w-sm w-full max-h-[70vh] overflow-y-auto mb-4">
            <img src={previewFolha} alt="Folha de Respostas" className="w-full h-auto border" />
          </div>
          
          <div className="bg-indigo-600 text-white p-4 rounded-xl max-w-sm w-full text-center shadow-lg">
            <p className="font-bold text-lg mb-1">Folha Pronta!</p>
            <p className="text-sm opacity-90">Toque e <strong>segure o dedo</strong> em cima da imagem acima para salvá-la no seu celular ou enviá-la.</p>
          </div>
        </div>
      )}
    </div>
  );
}


```
