import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../convex/_generated/api";
import { toast } from "sonner";

type InputType = "text" | "single_image" | "multiple_images";
type TabType = "simple" | "advanced";

interface CourseGroup {
  label: string;
  textInput: string;
  selectedImages: File[];
  pastedImages: string[];
}

export function CourseEvaluator() {
  const [activeTab, setActiveTab] = useState<TabType>("simple");
  const [inputType, setInputType] = useState<InputType>("text");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [currentResult, setCurrentResult] = useState<any>(null);
  
  // Simple mode state
  const [simpleTextInput, setSimpleTextInput] = useState("");
  const [simpleSelectedImages, setSimpleSelectedImages] = useState<File[]>([]);
  const [simplePastedImages, setSimplePastedImages] = useState<string[]>([]);
  
  // Advanced mode state - separate course groups
  const [externalCourses, setExternalCourses] = useState<CourseGroup>({
    label: "External Courses",
    textInput: "",
    selectedImages: [],
    pastedImages: []
  });
  
  const [internalCourses, setInternalCourses] = useState<CourseGroup>({
    label: "Internal Courses",
    textInput: "",
    selectedImages: [],
    pastedImages: []
  });
  
  const simpleFileInputRef = useRef<HTMLInputElement>(null);
  const simplePasteAreaRef = useRef<HTMLDivElement>(null);
  const externalFileInputRef = useRef<HTMLInputElement>(null);
  const internalFileInputRef = useRef<HTMLInputElement>(null);
  const externalPasteAreaRef = useRef<HTMLDivElement>(null);
  const internalPasteAreaRef = useRef<HTMLDivElement>(null);
  
  const generateUploadUrl = useMutation(api.evaluations.generateUploadUrl);
  const evaluateCourses = useAction(api.evaluations.evaluateCourses);
  const evaluations = useQuery(api.evaluations.listEvaluations) || [];

  // Handle clipboard paste events
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (inputType === "text") return;

      const activeElement = document.activeElement;
      let targetGroup: 'simple' | 'external' | 'internal' | null = null;
      
      if (activeTab === "simple" && simplePasteAreaRef.current?.contains(activeElement)) {
        targetGroup = 'simple';
      } else if (activeTab === "advanced") {
        if (externalPasteAreaRef.current?.contains(activeElement)) {
          targetGroup = 'external';
        } else if (internalPasteAreaRef.current?.contains(activeElement)) {
          targetGroup = 'internal';
        }
      }
      
      if (!targetGroup) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      const imageUrls: string[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
            const url = URL.createObjectURL(file);
            imageUrls.push(url);
          }
        }
      }

      if (imageFiles.length > 0) {
        if (activeTab === "simple") {
          const maxFiles = 1;
          if (simpleSelectedImages.length + imageFiles.length > maxFiles) {
            toast.error(`Maximum ${maxFiles} image allowed`);
            return;
          }
          setSimpleSelectedImages(prev => [...prev, ...imageFiles]);
          setSimplePastedImages(prev => [...prev, ...imageUrls]);
        } else {
          // No limit for advanced mode
          const targetGroup = document.activeElement?.closest('[data-group]')?.getAttribute('data-group');
          if (targetGroup === 'external' || targetGroup === 'internal') {
            const updateGroup = targetGroup === 'external' ? setExternalCourses : setInternalCourses;
            updateGroup(prev => ({
              ...prev,
              selectedImages: [...prev.selectedImages, ...imageFiles],
              pastedImages: [...prev.pastedImages, ...imageUrls]
            }));
          }
        }
        
        toast.success(`${imageFiles.length} image${imageFiles.length > 1 ? 's' : ''} pasted successfully!`);
        e.preventDefault();
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
      // Clean up object URLs
      simplePastedImages.forEach(url => URL.revokeObjectURL(url));
      externalCourses.pastedImages.forEach(url => URL.revokeObjectURL(url));
      internalCourses.pastedImages.forEach(url => URL.revokeObjectURL(url));
    };
  }, [inputType, activeTab, simpleSelectedImages.length, externalCourses.selectedImages.length, internalCourses.selectedImages.length]);

  // Clean up object URLs when component unmounts
  useEffect(() => {
    return () => {
      simplePastedImages.forEach(url => URL.revokeObjectURL(url));
      externalCourses.pastedImages.forEach(url => URL.revokeObjectURL(url));
      internalCourses.pastedImages.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const handleSimpleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const maxFiles = 1;
    
    const totalImages = simpleSelectedImages.length + files.length;
    if (totalImages > maxFiles) {
      toast.error(`Maximum ${maxFiles} image allowed`);
      return;
    }
    
    setSimpleSelectedImages(prev => [...prev, ...files]);
  };

  const handleAdvancedImageSelect = (event: React.ChangeEvent<HTMLInputElement>, group: 'external' | 'internal') => {
    const files = Array.from(event.target.files || []);
    
    const updateGroup = group === 'external' ? setExternalCourses : setInternalCourses;
    updateGroup(prev => ({
      ...prev,
      selectedImages: [...prev.selectedImages, ...files]
    }));
  };

  const removeSimpleImage = (index: number) => {
    setSimpleSelectedImages(prev => prev.filter((_, i) => i !== index));
    setSimplePastedImages(prev => {
      const newUrls = prev.filter((_, i) => i !== index);
      if (prev[index]) {
        URL.revokeObjectURL(prev[index]);
      }
      return newUrls;
    });
  };

  const removeAdvancedImage = (index: number, group: 'external' | 'internal') => {
    const updateGroup = group === 'external' ? setExternalCourses : setInternalCourses;
    
    updateGroup(prev => ({
      ...prev,
      selectedImages: prev.selectedImages.filter((_, i) => i !== index),
      pastedImages: prev.pastedImages.filter((_, i) => {
        if (i === index && prev.pastedImages[i]) {
          URL.revokeObjectURL(prev.pastedImages[i]);
        }
        return i !== index;
      })
    }));
  };

  const clearAllSimpleImages = () => {
    setSimpleSelectedImages([]);
    simplePastedImages.forEach(url => URL.revokeObjectURL(url));
    setSimplePastedImages([]);
    if (simpleFileInputRef.current) {
      simpleFileInputRef.current.value = "";
    }
  };

  const clearAllAdvancedImages = (group?: 'external' | 'internal') => {
    if (!group || group === 'external') {
      externalCourses.pastedImages.forEach(url => URL.revokeObjectURL(url));
      setExternalCourses(prev => ({
        ...prev,
        selectedImages: [],
        pastedImages: []
      }));
      if (externalFileInputRef.current) {
        externalFileInputRef.current.value = "";
      }
    }
    
    if (!group || group === 'internal') {
      internalCourses.pastedImages.forEach(url => URL.revokeObjectURL(url));
      setInternalCourses(prev => ({
        ...prev,
        selectedImages: [],
        pastedImages: []
      }));
      if (internalFileInputRef.current) {
        internalFileInputRef.current.value = "";
      }
    }
  };

  const clearAllText = () => {
    if (activeTab === "simple") {
      setSimpleTextInput("");
    } else {
      setExternalCourses(prev => ({ ...prev, textInput: "" }));
      setInternalCourses(prev => ({ ...prev, textInput: "" }));
    }
  };

  const uploadImages = async (files: File[]) => {
    const imageIds = [];
    
    for (const file of files) {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      
      if (!result.ok) {
        throw new Error("Failed to upload image");
      }
      
      const { storageId } = await result.json();
      imageIds.push(storageId);
    }
    
    return imageIds;
  };

  const handleEvaluate = async () => {
    // Validation
    if (activeTab === "simple") {
      if (inputType === "text" && !simpleTextInput.trim()) {
        toast.error("Please enter course descriptions");
        return;
      }
      if (inputType === "single_image" && simpleSelectedImages.length === 0) {
        toast.error("Please select or paste an image");
        return;
      }
    } else {
      if (inputType === "text") {
        if (!externalCourses.textInput.trim() && !internalCourses.textInput.trim()) {
          toast.error("Please enter course descriptions for at least one group");
          return;
        }
      } else {
        const totalImages = externalCourses.selectedImages.length + internalCourses.selectedImages.length;
        if (totalImages === 0) {
          toast.error("Please select or paste images for at least one group");
          return;
        }
      }
    }

    setIsEvaluating(true);
    
    try {
      let textInput = "";
      let imageIds: string[] = [];
      let externalCount = 0;
      let internalCount = 0;
      
      if (activeTab === "simple") {
        if (inputType === "text") {
          textInput = simpleTextInput;
        } else {
          imageIds = await uploadImages(simpleSelectedImages);
        }
        // For simple mode, we don't specify counts - let AI determine from context
      } else {
        if (inputType === "text") {
          const parts = [];
          if (externalCourses.textInput.trim()) {
            parts.push(`=== EXTERNAL COURSES ===\n${externalCourses.textInput.trim()}`);
            externalCount = 1;
          }
          if (internalCourses.textInput.trim()) {
            parts.push(`=== INTERNAL COURSES ===\n${internalCourses.textInput.trim()}`);
            internalCount = 1;
          }
          textInput = parts.join('\n\n');
        } else {
          if (externalCourses.selectedImages.length > 0) {
            const externalImageIds = await uploadImages(externalCourses.selectedImages);
            imageIds.push(...externalImageIds);
            externalCount = externalCourses.selectedImages.length;
          }
          if (internalCourses.selectedImages.length > 0) {
            const internalImageIds = await uploadImages(internalCourses.selectedImages);
            imageIds.push(...internalImageIds);
            internalCount = internalCourses.selectedImages.length;
          }
        }
      }
      
      const result = await evaluateCourses({
        inputType,
        textInput: textInput || undefined,
        imageIds: imageIds.length > 0 ? imageIds as any : undefined,
        externalCoursesCount: activeTab === "simple" ? undefined : externalCount,
        internalCoursesCount: activeTab === "simple" ? undefined : internalCount,
        isSimpleMode: activeTab === "simple",
      });
      
      setCurrentResult(result);
      toast.success("Evaluation completed!");
      
      // Clear form
      clearAllText();
      if (activeTab === "simple") {
        clearAllSimpleImages();
      } else {
        clearAllAdvancedImages();
      }
      
    } catch (error) {
      console.error("Evaluation failed:", error);
      toast.error("Failed to evaluate courses");
    } finally {
      setIsEvaluating(false);
    }
  };

  const renderSimpleMode = () => {
    return (
      <div className="space-y-6">
        {/* Input Type Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">Input Type</label>
          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                value="text"
                checked={inputType === "text"}
                onChange={(e) => {
                  setInputType(e.target.value as InputType);
                  clearAllSimpleImages();
                }}
                className="mr-2"
              />
              Text Input
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="single_image"
                checked={inputType === "single_image"}
                onChange={(e) => {
                  setInputType(e.target.value as InputType);
                  clearAllSimpleImages();
                }}
                className="mr-2"
              />
              Single Image
            </label>
          </div>
        </div>

        {/* Text Input */}
        {inputType === "text" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Course Descriptions
            </label>
            <p className="text-sm text-gray-600 mb-2">
              Enter both external and internal course descriptions. Please label them clearly (e.g., "External Course:" and "Internal Course:").
            </p>
            <textarea
              value={simpleTextInput}
              onChange={(e) => setSimpleTextInput(e.target.value)}
              placeholder="External Course: [Enter external course description here]&#10;&#10;Internal Course: [Enter internal course description here]"
              className="w-full h-40 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        )}

        {/* Image Input */}
        {inputType === "single_image" && (
          <div ref={simplePasteAreaRef}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload Course Description Image
            </label>
            <p className="text-sm text-gray-600 mb-2">
              Upload an image with both course descriptions. Place the external course on the left and internal course on the right.
            </p>
            
            {/* File Input */}
            <input
              ref={simpleFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleSimpleImageSelect}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-3"
            />
            
            {/* Paste Area */}
            <div 
              tabIndex={0}
              className="w-full min-h-24 px-3 py-4 border-2 border-dashed border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
              onClick={() => simplePasteAreaRef.current?.focus()}
            >
              <div className="text-center text-gray-600">
                <div className="text-sm font-medium mb-1">
                  📋 Click here and paste image from clipboard
                </div>
                <div className="text-xs text-gray-500">
                  Or use the file input above to browse for an image
                </div>
              </div>
            </div>
            
            {/* Selected Images Preview */}
            {simpleSelectedImages.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-gray-700">
                    Selected Image
                  </div>
                  <button
                    onClick={clearAllSimpleImages}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Clear
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {simpleSelectedImages.map((file, index) => (
                    <div key={index} className="relative border rounded-lg p-2 bg-white">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-gray-600 truncate flex-1 mr-2">
                          {file.name}
                        </div>
                        <button
                          onClick={() => removeSimpleImage(index)}
                          className="text-red-500 hover:text-red-700 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                      {simplePastedImages[index] && (
                        <img
                          src={simplePastedImages[index]}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-32 object-contain border rounded"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderAdvancedCourseGroup = (
    group: CourseGroup,
    groupType: 'external' | 'internal',
    updateGroup: (updater: (prev: CourseGroup) => CourseGroup) => void,
    fileInputRef: React.RefObject<HTMLInputElement | null>,
    pasteAreaRef: React.RefObject<HTMLDivElement | null>
  ) => {
    return (
      <div className="border rounded-lg p-4 bg-gray-50">
        <h3 className="text-lg font-medium mb-4 text-gray-800">{group.label}</h3>
        
        {inputType === "text" ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Course Descriptions
            </label>
            <textarea
              value={group.textInput}
              onChange={(e) => updateGroup(prev => ({ ...prev, textInput: e.target.value }))}
              placeholder={`Enter ${groupType} course descriptions...`}
              className="w-full h-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        ) : (
          <div ref={pasteAreaRef} data-group={groupType}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload Course Description Image{inputType === "multiple_images" ? "s" : ""}
            </label>
            
            {/* File Input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple={inputType === "multiple_images"}
              onChange={(e) => handleAdvancedImageSelect(e, groupType)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-3"
            />
            
            {/* Paste Area */}
            <div 
              tabIndex={0}
              className="w-full min-h-20 px-3 py-4 border-2 border-dashed border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:bg-gray-50 transition-colors cursor-pointer"
              onClick={() => pasteAreaRef.current?.focus()}
            >
              <div className="text-center text-gray-600">
                <div className="text-sm font-medium mb-1">
                  📋 Click here and paste images
                </div>
                <div className="text-xs text-gray-500">
                  Or use the file input above
                </div>
              </div>
            </div>
            
            {/* Selected Images Preview */}
            {group.selectedImages.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-gray-700">
                    Selected Images ({group.selectedImages.length})
                  </div>
                  <button
                    onClick={() => clearAllAdvancedImages(groupType)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Clear All
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {group.selectedImages.map((file, index) => (
                    <div key={index} className="relative border rounded-lg p-2 bg-white">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-gray-600 truncate flex-1 mr-2">
                          {file.name}
                        </div>
                        <button
                          onClick={() => removeAdvancedImage(index, groupType)}
                          className="text-red-500 hover:text-red-700 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                      {group.pastedImages[index] && (
                        <img
                          src={group.pastedImages[index]}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-32 object-contain border rounded"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderAdvancedMode = () => {
    return (
      <div className="space-y-6">
        {/* Input Type Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">Input Type</label>
          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                value="text"
                checked={inputType === "text"}
                onChange={(e) => {
                  setInputType(e.target.value as InputType);
                  clearAllAdvancedImages();
                }}
                className="mr-2"
              />
              Text Input
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="single_image"
                checked={inputType === "single_image"}
                onChange={(e) => {
                  setInputType(e.target.value as InputType);
                  clearAllAdvancedImages();
                }}
                className="mr-2"
              />
              Single Image
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="multiple_images"
                checked={inputType === "multiple_images"}
                onChange={(e) => {
                  setInputType(e.target.value as InputType);
                  clearAllAdvancedImages();
                }}
                className="mr-2"
              />
              Multiple Images
            </label>
          </div>
        </div>

        {/* Course Groups */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {renderAdvancedCourseGroup(
            externalCourses,
            'external',
            setExternalCourses,
            externalFileInputRef,
            externalPasteAreaRef
          )}
          
          {renderAdvancedCourseGroup(
            internalCourses,
            'internal',
            setInternalCourses,
            internalFileInputRef,
            internalPasteAreaRef
          )}
        </div>
      </div>
    );
  };

  const renderResult = (result: any) => {
    const isEquivalent = result.conclusion.toLowerCase().includes("equivalent") && 
                        !result.conclusion.toLowerCase().includes("not equivalent");
    
    return (
      <div className="bg-white rounded-lg shadow-sm border p-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <div className={`w-3 h-3 rounded-full ${isEquivalent ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <h3 className="text-lg font-semibold">Evaluation Result</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-gray-50 rounded p-3">
            <div className="text-sm font-medium text-gray-600 mb-1">Coverage</div>
            <div className="text-lg font-semibold">{result.coverage}</div>
          </div>
          <div className="bg-gray-50 rounded p-3">
            <div className="text-sm font-medium text-gray-600 mb-1">Confidence</div>
            <div className="text-lg font-semibold">{result.confidence}</div>
          </div>
        </div>
        
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-gray-600 mb-2">Conclusion</div>
            <div className={`p-3 rounded ${isEquivalent ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {result.conclusion}
            </div>
          </div>
          
          {result.courseMatches && (
            <div>
              <div className="text-sm font-medium text-gray-600 mb-2">Course Matches</div>
              <div className="bg-blue-50 p-3 rounded text-sm leading-relaxed text-blue-800">
                {result.courseMatches}
              </div>
            </div>
          )}
          
          <div>
            <div className="text-sm font-medium text-gray-600 mb-2">Reasoning</div>
            <div className="bg-gray-50 p-3 rounded text-sm leading-relaxed">
              {result.reasoning}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Input Form */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h2 className="text-xl font-semibold mb-4">Evaluate Course Equivalency</h2>
        
        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => setActiveTab("simple")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "simple"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Simple
          </button>
          <button
            onClick={() => setActiveTab("advanced")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "advanced"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Advanced
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "simple" ? renderSimpleMode() : renderAdvancedMode()}

        <button
          onClick={handleEvaluate}
          disabled={isEvaluating}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-6"
        >
          {isEvaluating ? "Evaluating..." : "Evaluate Course Equivalency"}
        </button>
      </div>

      {/* Current Result */}
      {currentResult && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Latest Result</h2>
          {renderResult(currentResult)}
        </div>
      )}

      {/* Previous Evaluations */}
      {evaluations.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Previous Evaluations</h2>
          <div className="space-y-4">
            {evaluations.map((evaluation) => (
              <div key={evaluation._id} className="border-l-4 border-gray-200 pl-4">
                <div className="text-sm text-gray-500 mb-2">
                  {new Date(evaluation._creationTime).toLocaleString()} • {evaluation.inputType.replace("_", " ")}
                  {evaluation.externalCoursesCount !== undefined && evaluation.internalCoursesCount !== undefined && (
                    <span className="ml-2">
                      ({evaluation.externalCoursesCount} external, {evaluation.internalCoursesCount} internal)
                    </span>
                  )}
                </div>
                {renderResult(evaluation.result)}
                
                {evaluation.textInput && (
                  <div className="mt-3 p-3 bg-gray-50 rounded text-sm">
                    <div className="font-medium text-gray-600 mb-1">Original Input:</div>
                    <div className="text-gray-700 whitespace-pre-wrap">{evaluation.textInput}</div>
                  </div>
                )}
                
                {evaluation.imageUrls && evaluation.imageUrls.length > 0 && (
                  <div className="mt-3">
                    <div className="font-medium text-gray-600 mb-2">Images:</div>
                    <div className="flex gap-2 flex-wrap">
                      {evaluation.imageUrls.map((url, index) => (
                        url && (
                          <div key={index} className="relative">
                            <img
                              src={url}
                              alt={`Course description ${index + 1}`}
                              className="max-w-xs max-h-40 object-contain border rounded"
                            />
                            {evaluation.externalCoursesCount !== undefined && evaluation.internalCoursesCount !== undefined && (
                              <div className="absolute top-1 left-1 bg-black bg-opacity-70 text-white text-xs px-1 rounded">
                                {evaluation.externalCoursesCount && index < evaluation.externalCoursesCount ? 'External' : 'Internal'}
                              </div>
                            )}
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
