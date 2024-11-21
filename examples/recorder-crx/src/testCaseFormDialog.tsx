import React from "react";
import { Dialog } from "./dialog";

export const TestCaseFormDialog: React.FC<{
  show: boolean,
  onCreate: (params: { name: string, title: string }) => any,
  onClose: () => any
}> = ({ show, onCreate, onClose }) => {

  const [name, setName] = React.useState<string>('');
  const [title, setTitle] = React.useState<string>('test');
  const [canSave, setCanSave] = React.useState<boolean>();
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    setCanSave(formRef.current?.reportValidity());
  }, [name, title]);

  React.useEffect(() => {
    setName('');
    setTitle('test');
  }, [show]);

  return <Dialog title="Preferences" isOpen={show} onClose={onClose}>
    <form ref={formRef} onSubmit={e => {
      e.preventDefault();
      onCreate({ title, name });
    }}>
      <label htmlFor="title">Name:</label>
      <input
        type="text"
        id="name"
        name="name"
        placeholder="Enter test name"
        pattern="[a-zA-Z][\w\-]*"
        title="Must be a valid file name"
        value={name}
        required
        onChange={e => setName(e.target.value)}
      />
      <label htmlFor="title">Test Title:</label>
      <input
        type="text"
        id="title"
        name="title"
        placeholder="Enter test title"
        value={title}
        required
        onChange={e => setTitle(e.target.value)}
      />
      <button id="submit" type="submit" disabled={!canSave}>{canSave ? 'Create' : 'Created'}</button>
    </form>
  </Dialog>;
};