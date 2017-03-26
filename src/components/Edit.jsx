import React, { Component, PropTypes } from 'react'
import {
  Button,
  Card,
  Form,
  TextArea,
} from 'semantic-ui-react'

class Editor extends Component {
  static propTypes = {
    match: PropTypes.shape({
      params: PropTypes.shape({
        id: PropTypes.string.isRequired,
      }).isRequired,
    }).isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {
      data: {},
    }
    this.submit = this.submit.bind(this)
  }

  componentDidMount() {
    fetch(`/api/v1/list/${this.props.match.params.id}`)
      .then(response => response.json())
      .then(data => data.body)
      .then(data => this.setState({ data }))
  }

  submit(e) {
    e.preventDefault()
    console.log(this.state)
  }

  render() {
    const { list } = this.state.data
    return (
      <Form action={`/api/v1/save/${this.props.match.params.id}`} method="POST" onSubmit={this.submit}>
        <div style={{ padding: '10px' }}>
          <h2>Edit</h2>
          <Card>
            <Card.Content className="card-block">
              <TextArea name="markdown" autoHeight autoFocus placeholder="Loading..." value={list} />
            </Card.Content>
            <Card.Content extra>
              <Button type="reset" className="btn btn-danger btn-sm">Reset</Button>
              <Button type="submit" className="btn btn-success btn-sm">Save</Button>
            </Card.Content>
          </Card>
        </div>
      </Form>
    )
  }
}

export default Editor
