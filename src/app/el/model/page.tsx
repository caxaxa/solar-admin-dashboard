import { Sidebar } from '@/components/shared/Sidebar';
import { Header } from '@/components/shared/Header';
import { Cpu } from 'lucide-react';

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
              Manage the EL defect detection model
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <Cpu className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">
              EL model management will be available once a trained Detectron2 model is ready.
            </p>
            <p className="text-sm text-gray-400 mt-2">
              Currently using mock detection (random bounding boxes).
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
