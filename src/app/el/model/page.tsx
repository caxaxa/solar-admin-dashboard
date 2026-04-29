import { Sidebar } from '@/components/shared/Sidebar';
import { Header } from '@/components/shared/Header';
import { Cpu, CheckCircle2 } from 'lucide-react';

const ACTIVE_VERSION = 'v1-20260424';
const MODEL_S3_URI = `s3://solar-ai-training/detectron2-el-models/${ACTIVE_VERSION}/model_final.pth`;
const MODEL_REPO_URL = 'https://github.com/caxaxa/el-detection-model';

const CLASSES = [
  { name: 'crack', rule: 'any → Reprovado' },
  { name: 'micro-crack', rule: '> 5 → Reprovado' },
  { name: 'finger-interruption', rule: 'any → Reprovado' },
  { name: 'dead-cell', rule: 'any → Reprovado' },
];

export default function ELModelPage() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900">EL AI Model</h2>
            <p className="text-sm text-gray-500">
              Detectron2 defect detection — current state
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6 mb-4">
            <div className="flex items-start gap-4">
              <Cpu className="h-10 w-10 text-blue-500 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-semibold text-gray-900">Active model</h3>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 rounded-full px-2 py-0.5">
                    <CheckCircle2 className="h-3 w-3" />
                    batch mode
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  AI Detection submits the <code className="bg-gray-100 px-1 rounded">solar-el-inference-{'{env}'}</code> AWS Batch job, which runs Detectron2 (Faster R-CNN R50-FPN) over each panel image.
                </p>

                <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Version</dt>
                    <dd className="font-mono text-gray-900">{ACTIVE_VERSION}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Architecture</dt>
                    <dd className="text-gray-900">Faster R-CNN R50-FPN</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Confidence threshold</dt>
                    <dd className="text-gray-900">0.25</dd>
                  </div>
                </dl>

                <div className="mt-4">
                  <dt className="text-xs uppercase tracking-wide text-gray-500">Weights</dt>
                  <dd className="font-mono text-xs text-gray-700 break-all">{MODEL_S3_URI}</dd>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6 mb-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Defect classes</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Idx</th>
                  <th className="pb-2 font-medium">Label</th>
                  <th className="pb-2 font-medium">Approval impact</th>
                </tr>
              </thead>
              <tbody>
                {CLASSES.map((c, i) => (
                  <tr key={c.name} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 font-mono text-gray-500">{i}</td>
                    <td className="py-2 font-mono text-gray-900">{c.name}</td>
                    <td className="py-2 text-gray-600">{c.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-900">
            <p className="font-semibold mb-1">Bootstrap state</p>
            <p>
              <code className="bg-white px-1 rounded">{ACTIVE_VERSION}</code> was trained on a single released project (20 images, 98 annotations — predominantly <code className="bg-white px-1 rounded">micro-crack</code>). The 4-class architecture is in place; the other three classes will improve as more projects are released. Retraining is currently manual — see <a href={MODEL_REPO_URL} className="underline" target="_blank" rel="noreferrer">{MODEL_REPO_URL}</a>.
            </p>
          </div>

          <div className="mt-4 text-xs text-gray-500">
            Version listing, promotion, and one-click retrain are pending (Phase 2).
          </div>
        </main>
      </div>
    </div>
  );
}
