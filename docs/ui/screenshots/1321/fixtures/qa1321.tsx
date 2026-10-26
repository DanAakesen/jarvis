import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ReviewSummary } from './src/ReviewSummary';
import { ToolCallChip } from './src/ToolCallChip';
import { AttentionPopover } from './src/AttentionPopover';
import './src/styles.css';
import './src/ConversationHistory.css';
const summary = 'Review this exact synthetic food estimate. Nothing has changed.\nMeal: Synthetic portion\nNutrition:\n- Protein: 12.5 g\n- Calories: 300 kcal\n- Fat: 8 g\n- Carbohydrates: unknown (not zero) g\nUncertainty: estimated grams, not measured.';
createRoot(document.getElementById('root')!).render(<MemoryRouter><main style={{padding:24,maxWidth:700,margin:'auto'}}>
<h1>Synthetic Health estimate QA</h1>
<AttentionPopover attention={{items:[], confirmations:[{id:'fixture',actionKind:'other',summary,expiresAt:new Date(Date.now()+120000).toISOString()}],onResolveConfirmation:async()=>{document.body.dataset.resolved='true';}}}/>
<ToolCallChip tool="daily_food_review" state="ok"/>
<div className="streaming-food-invitation" role="status" aria-label="Food estimate awaiting your reply"><ReviewSummary text={summary}/><p>Would you like to log this estimate? Nothing has been logged yet.</p></div>
</main></MemoryRouter>);
