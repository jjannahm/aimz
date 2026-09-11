import { CompactPicker } from '@/src/components/CompactPicker';

/** The season control, which is the compact picker naming seasons. */
export function SeasonPicker({ season, seasons, onChange, completed = false, fullWidth = false }: {
  season: string;
  seasons: string[];
  onChange: (season: string) => void;
  /** Whether the chosen season has been ended, which the control says quietly. */
  completed?: boolean;
  fullWidth?: boolean;
}) {
  return <CompactPicker
    label="Season"
    muted={completed}
    fullWidth={fullWidth}
    onChange={onChange}
    options={seasons}
    testID="season-picker"
    title="Season"
    value={season}
  />;
}
