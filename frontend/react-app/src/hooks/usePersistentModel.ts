import { useState, useEffect } from 'react';

const MODEL_STORAGE_KEY = 'cosine_selected_model';
const DEFAULT_MODEL = 'claude-opus-4-1'; // Balanced

export const usePersistentModel = () => {
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);

  // Load model from localStorage on mount
  useEffect(() => {
    try {
      const storedModel = localStorage.getItem(MODEL_STORAGE_KEY);
      if (storedModel) {
        // Validate that the stored model is one of the available options
        const availableModels = [
          'claude-opus-4-1',
          'claude-3-haiku', 
          'nova-lite',
          'gpt-oss-120b',
          'gpt-oss-20b'
        ];
        
        if (availableModels.includes(storedModel)) {
          setSelectedModel(storedModel);
          console.log('🔄 Loaded persistent model from localStorage:', storedModel);
        } else {
          console.warn('⚠️ Invalid model in localStorage, using default:', storedModel);
          setSelectedModel(DEFAULT_MODEL);
          localStorage.setItem(MODEL_STORAGE_KEY, DEFAULT_MODEL);
        }
      } else {
        // No stored model, use default and store it
        setSelectedModel(DEFAULT_MODEL);
        localStorage.setItem(MODEL_STORAGE_KEY, DEFAULT_MODEL);
        console.log('🔄 No stored model found, using default:', DEFAULT_MODEL);
      }
    } catch (error) {
      console.error('❌ Error loading model from localStorage:', error);
      setSelectedModel(DEFAULT_MODEL);
    }
  }, []);

  // Function to update model and persist to localStorage
  const updateModel = (newModel: string) => {
    try {
      // Validate the new model
      const availableModels = [
        'claude-opus-4-1',
        'claude-haiku-4-5', 
        'nova-lite',
        'gpt-oss-120b',
        'gpt-oss-20b'
      ];
      
      if (availableModels.includes(newModel)) {
        setSelectedModel(newModel);
        localStorage.setItem(MODEL_STORAGE_KEY, newModel);
        console.log('🔄 Model updated and persisted:', newModel);
      } else {
        console.warn('⚠️ Invalid model selected:', newModel);
      }
    } catch (error) {
      console.error('❌ Error saving model to localStorage:', error);
    }
  };

  return {
    selectedModel,
    setSelectedModel: updateModel,
    defaultModel: DEFAULT_MODEL
  };
};
