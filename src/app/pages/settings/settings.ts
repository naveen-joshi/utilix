import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { ElectronService } from '../../services/electron.service';

type SaveMode = 'ask' | 'auto';

interface SavePreferences {
    mode: SaveMode;
    defaultDirectory: string;
}

@Component({
    selector: 'app-settings',
    imports: [
        FormsModule,
        SelectModule,
        ButtonModule,
        InputTextModule,
        ToastModule,
    ],
    providers: [MessageService],
    templateUrl: './settings.html',
    styleUrl: './settings.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
    private readonly electronService = inject(ElectronService);
    private readonly messageService = inject(MessageService);

    protected readonly isLoading = signal(true);
    protected readonly isSaving = signal(false);
    protected readonly saveMode = signal<SaveMode>('ask');
    protected readonly defaultDirectory = signal('');

    protected readonly saveModeOptions = [
        { label: 'Ask Every Time', value: 'ask' },
        { label: 'Save Automatically', value: 'auto' },
    ];

    protected readonly needsDirectory = computed(() => this.saveMode() === 'auto');

    constructor() {
        void this.loadPreferences();
    }

    async browseDirectory(): Promise<void> {
        if (!this.electronService.isElectron) {
            return;
        }

        try {
            const selected = await this.electronService.pickSaveDirectory();
            if (selected) {
                this.defaultDirectory.set(selected);
            }
        } catch {
            this.messageService.add({
                severity: 'error',
                summary: 'Browse Failed',
                detail: 'Could not open the directory picker.',
            });
        }
    }

    async savePreferences(): Promise<void> {
        if (!this.electronService.isElectron) {
            return;
        }

        if (this.needsDirectory() && !this.defaultDirectory().trim()) {
            this.messageService.add({
                severity: 'warn',
                summary: 'Directory Required',
                detail: 'Choose a default save directory for automatic mode.',
            });
            return;
        }

        this.isSaving.set(true);
        try {
            const updated = (await this.electronService.updateSavePreferences({
                mode: this.saveMode(),
                defaultDirectory: this.defaultDirectory().trim(),
            })) as SavePreferences;

            this.saveMode.set(updated.mode);
            this.defaultDirectory.set(updated.defaultDirectory);

            this.messageService.add({
                severity: 'success',
                summary: 'Preferences Saved',
                detail: updated.mode === 'ask'
                    ? 'Utilix will ask where to save every file.'
                    : `Utilix will save automatically to ${updated.defaultDirectory}`,
            });
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'Failed to save preferences.';
            this.messageService.add({
                severity: 'error',
                summary: 'Save Failed',
                detail,
            });
        } finally {
            this.isSaving.set(false);
        }
    }

    private async loadPreferences(): Promise<void> {
        if (!this.electronService.isElectron) {
            this.isLoading.set(false);
            return;
        }

        try {
            const preferences = (await this.electronService.getSavePreferences()) as SavePreferences;
            this.saveMode.set(preferences.mode);
            this.defaultDirectory.set(preferences.defaultDirectory);
        } catch {
            this.messageService.add({
                severity: 'warn',
                summary: 'Defaults Loaded',
                detail: 'Could not load saved preferences. Using defaults.',
            });
        } finally {
            this.isLoading.set(false);
        }
    }
}
